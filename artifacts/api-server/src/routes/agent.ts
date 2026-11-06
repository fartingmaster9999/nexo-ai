import { Router, type IRouter } from "express";
import { StreamAgentChatBody, type AgentToolExchange } from "@workspace/api-zod";
import { isValidTimeZone } from "../lib/chat-request";
import { GeminiSseDecoder, validateImageData } from "../lib/gemini-image";
import { isPublicUrl } from "../lib/public-scraper";
import { searchWeb, type SearchResult } from "../lib/web-search";
import { requestGeminiWithRetry, waitForGeminiRetry } from "../lib/gemini-retry";
import {
  buildGeminiAgentRequest, collectAgentResponse, GeminiAgentApiError, geminiAgentErrorMessage,
  GEMINI_AGENT_FALLBACK_MODEL, GEMINI_AGENT_MODEL, MAX_AGENT_CODE_CHARS, MAX_AGENT_RESULT_CHARS, MAX_AGENT_TOOL_CALLS,
  requestGeminiAgentStream, validateAgentHistory,
} from "../lib/gemini-agent";
import { CHAT_DEADLINE_MS, PROVIDER_IDLE_MS, writeChatEvent } from "../lib/chat-runtime";

type AgentRouterOptions = {
  getApiKey?: () => string | undefined;
  fetchImpl?: typeof fetch;
  search?: typeof searchWeb;
  now?: () => Date;
  providerIdleMs?: number;
};

class AgentPublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPublicError";
  }
}

function sameToolArguments(left: AgentToolExchange, right: { tool: string; arguments: Record<string, unknown> }) {
  if (left.tool !== right.tool) return false;
  if (left.tool === "web_search") {
    return String(left.arguments.query).trim().toLowerCase() === String(right.arguments.query).trim().toLowerCase();
  }
  return left.arguments.language === right.arguments.language && left.arguments.code === right.arguments.code;
}

function safeResultText(result: string) {
  return result.slice(0, MAX_AGENT_RESULT_CHARS);
}

function cleanSources(sources: SearchResult["sources"]) {
  return sources
    .filter((source) => isPublicUrl(source.url))
    .slice(0, 5)
    .map((source) => ({ title: source.title.slice(0, 300), url: source.url.slice(0, 2048) }));
}

export function createAgentRouter({
  getApiKey = () => process.env.GEMINI_API_KEY,
  fetchImpl = fetch,
  search = searchWeb,
  now = () => new Date(),
  providerIdleMs = PROVIDER_IDLE_MS,
}: AgentRouterOptions = {}): IRouter {
  const router: IRouter = Router();

  router.post("/agent", async (req, res): Promise<void> => {
    const parsed = StreamAgentChatBody.safeParse(req.body);
    if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") {
      res.status(400).json({ error: "Please provide a valid conversation ending with your message." });
      return;
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "Nexo Agent is not configured. Add GEMINI_API_KEY to the server environment." });
      return;
    }
    if (parsed.data.timeZone !== undefined && !isValidTimeZone(parsed.data.timeZone)) {
      res.status(400).json({ error: "The provided timezone is invalid." });
      return;
    }
    if (parsed.data.image) {
      try {
        validateImageData(parsed.data.image.mimeType, parsed.data.image.data);
      } catch {
        res.status(400).json({ error: "The image data is invalid. Choose a JPEG, PNG, or WebP image under 3 MB." });
        return;
      }
    }
    const history: AgentToolExchange[] = (parsed.data.agentHistory ?? []).map((exchange) => ({
      ...exchange,
      ...(exchange.sources ? { sources: cleanSources(exchange.sources) } : {}),
    }));
    const historyError = validateAgentHistory(history);
    if (historyError) {
      res.status(400).json({ error: historyError });
      return;
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    let timedOut = false;
    let activeModel = GEMINI_AGENT_MODEL;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Gemini Agent request deadline exceeded"));
    }, CHAT_DEADLINE_MS);
    const abortOnDisconnect = () => {
      if (!res.writableEnded) controller.abort(new Error("Client disconnected"));
    };
    res.on("close", abortOnDisconnect);
    const emit = (event: object) => writeChatEvent(res, event, controller.signal);

    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Request-Id", String(req.id));
      res.flushHeaders();
      heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded && res.writableLength === 0) res.write(": keepalive\n\n");
      }, 10000);
      await emit({ model: GEMINI_AGENT_MODEL });
      if (parsed.data.image && history.length === 0) {
        await emit({ activity: { id: "image-analysis", label: "Analyzing the attached image", kind: "thinking", status: "running" } });
      }

      let answer = "";
      let toolCalls = history.length;
      let imageAnalysisComplete = history.length > 0;
      const switchToFallback = async (status?: number) => {
        if (activeModel !== GEMINI_AGENT_MODEL || toolCalls !== 0) return false;
        activeModel = GEMINI_AGENT_FALLBACK_MODEL;
        req.log.warn({
          provider: "gemini",
          model: GEMINI_AGENT_MODEL,
          fallbackModel: activeModel,
          ...(status !== undefined ? { status } : {}),
        }, "Gemini Agent primary model unavailable; retrying with fallback");
        await emit({ model: activeModel });
        await emit({
          notice: {
            id: "gemini-agent-model-fallback",
            message: "Gemini 3.8 Flash is unavailable right now. Nexo Agent switched to Gemini 3.6 Flash.",
            model: activeModel,
          },
        });
        return true;
      };
      let modelIdleRetries = 0;
      while (true) {
        controller.signal.throwIfAborted();
        const allowTools = toolCalls < MAX_AGENT_TOOL_CALLS;
        const request = buildGeminiAgentRequest({
          ...parsed.data,
          agentHistory: history,
        }, now(), allowTools);
        const attemptController = new AbortController();
        const abortAttempt = () => attemptController.abort(controller.signal.reason);
        if (controller.signal.aborted) abortAttempt();
        else controller.signal.addEventListener("abort", abortAttempt, { once: true });
        let attemptTimedOut = false;
        const resetIdle = () => {
          clearTimeout(idle);
          idle = setTimeout(() => {
            attemptTimedOut = true;
            attemptController.abort(new Error("Gemini Agent stream stalled"));
          }, providerIdleMs);
        };
        let modelResponse: ReturnType<typeof collectAgentResponse> | null = null;
        try {
          resetIdle();
          const upstream = await requestGeminiWithRetry(
            () => requestGeminiAgentStream(apiKey, request, attemptController.signal, fetchImpl, activeModel),
            attemptController.signal,
          );
          if (!upstream.ok) {
            await upstream.body?.cancel().catch(() => {});
            if ((upstream.status === 429 || upstream.status >= 500) && await switchToFallback(upstream.status)) continue;
            req.log.warn({ provider: "gemini", model: activeModel, status: upstream.status }, "Gemini Agent request rejected");
            throw new GeminiAgentApiError(upstream.status);
          }
          if (!upstream.body) throw new AgentPublicError("Gemini returned an empty Agent response. Please try again.");

          const decoder = new GeminiSseDecoder();
          const reader = upstream.body.getReader();
          const events: unknown[] = [];
          let eventChars = 0;
          try {
            while (true) {
              attemptController.signal.throwIfAborted();
              const { value, done } = await reader.read();
              if (attemptController.signal.aborted) throw attemptController.signal.reason;
              if (done) break;
              resetIdle();
              const decoded = decoder.push(value);
              for (const item of decoded) {
                eventChars += JSON.stringify(item).length;
                if (eventChars > 160_000) throw new AgentPublicError("Gemini's Agent response exceeded the safe output limit.");
                events.push(item);
              }
            }
            for (const item of decoder.push()) {
              eventChars += JSON.stringify(item).length;
              if (eventChars > 160_000) throw new AgentPublicError("Gemini's Agent response exceeded the safe output limit.");
              events.push(item);
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
          modelResponse = collectAgentResponse(events);
        } catch (error) {
          if (attemptTimedOut && await switchToFallback()) continue;
          if (attemptTimedOut && modelIdleRetries < 1 && !controller.signal.aborted) {
            modelIdleRetries++;
            req.log.warn({ provider: "gemini", model: activeModel, retry: modelIdleRetries }, "Gemini Agent stream stalled; retrying the same model");
            await waitForGeminiRetry(controller.signal, 500);
            continue;
          }
          if (attemptTimedOut) timedOut = true;
          throw error;
        } finally {
          clearTimeout(idle);
          controller.signal.removeEventListener("abort", abortAttempt);
          attemptController.abort();
        }

        if (!modelResponse) throw new AgentPublicError("Gemini returned no Agent response. Please try again.");
        modelIdleRetries = 0;
        if (parsed.data.image && !imageAnalysisComplete) {
          imageAnalysisComplete = true;
          await emit({ activity: { id: "image-analysis", label: "Image analysis complete", kind: "thinking", status: "complete" } });
        }
        if (modelResponse.calls.length > 1) {
          throw new AgentPublicError("Nexo Agent requested multiple tools at once. Please try a more focused request.");
        }
        const call = modelResponse.calls[0];
        if (!call) {
          answer = modelResponse.text.trim();
          if (!answer) throw new AgentPublicError("Nexo Agent returned no answer. Please try again.");
          break;
        }
        if (!allowTools || toolCalls >= MAX_AGENT_TOOL_CALLS) {
          throw new AgentPublicError("Nexo Agent reached its tool limit before finishing. Try a more focused request.");
        }
        toolCalls += 1;

        if (call.tool === "web_search") {
          const query = call.arguments.query;
          if (typeof query !== "string" || query.trim().length < 2 || query.length > 300) {
            throw new AgentPublicError("Nexo Agent returned an invalid web search request.");
          }
          const arguments_ = { query: query.trim() };
          const previous = history.find((exchange) => sameToolArguments(exchange, { tool: call.tool, arguments: arguments_ }));
          const activityId = `agent-search-${call.callId}`;
          let result = "";
          let sources: AgentToolExchange["sources"] = [];
          await emit({ activity: { id: activityId, label: previous ? "Reusing an earlier web search" : "Searching the web for current information…", kind: "search", status: "running" } });
          try {
            if (previous) {
              result = `This exact search was already performed. Reuse the previous result:\n${previous.result}`;
              sources = previous.sources ?? [];
              await emit({ activity: { id: activityId, label: "Reused an earlier web search", kind: "search", status: "complete" } });
            } else {
              const searchResult = await search(arguments_.query);
              sources = cleanSources(searchResult.sources);
              result = searchResult.context.slice(0, MAX_AGENT_RESULT_CHARS);
              if (sources.length) await emit({ sources });
              await emit({ activity: { id: activityId, label: `Found ${sources.length} public source${sources.length === 1 ? "" : "s"}`, kind: "search", status: "complete" } });
            }
          } catch {
            result = "Web search failed. Do not claim that current facts were verified; answer only with available knowledge and state this limitation.";
            await emit({ activity: { id: activityId, label: "Web search was unavailable", kind: "search", status: "error" } });
          }
          history.push({
            tool: call.tool,
            callId: call.callId,
            thoughtSignature: call.thoughtSignature,
            arguments: arguments_,
            result: safeResultText(result),
            ...(sources?.length ? { sources } : {}),
          });
          continue;
        }

        const language = call.arguments.language;
        const code = call.arguments.code;
        if ((language !== "python" && language !== "javascript" && language !== "html") ||
            typeof code !== "string" || !code.trim() || code.length > MAX_AGENT_CODE_CHARS) {
          throw new AgentPublicError("Nexo Agent returned unsupported or oversized code. Please try a smaller request.");
        }
        const arguments_ = { language: language as "python" | "javascript" | "html", code };
        const previous = history.find((exchange) => sameToolArguments(exchange, { tool: call.tool, arguments: arguments_ }));
        if (previous) {
          history.push({
            tool: call.tool,
            callId: call.callId,
            thoughtSignature: call.thoughtSignature,
            arguments: arguments_,
            result: safeResultText(`This exact code already ran. Reuse the previous result instead of running it again:\n${previous.result}`),
          });
          await emit({ activity: { id: `agent-code-${call.callId}`, label: "Reused the earlier browser run", kind: "code", status: "complete" } });
          continue;
        }
        await emit({ activity: { id: `agent-code-${call.callId}`, label: `Running ${language} code in the isolated browser…`, kind: "code", status: "running" } });
        await emit({
          agentTool: {
            tool: call.tool,
            callId: call.callId,
            thoughtSignature: call.thoughtSignature,
            arguments: arguments_,
            history,
          },
        });
        await emit({ done: true });
        res.end();
        return;
      }

      for (let offset = 0; offset < answer.length; offset += 900) {
        controller.signal.throwIfAborted();
        await emit({ content: answer.slice(offset, offset + 900) });
      }
      await emit({ activity: { id: "agent-finished", label: "Agent completed the request", kind: "info", status: "complete" } });
      await emit({ done: true });
      res.end();
      req.log.info({ event: "agent.stream.completed", model: activeModel, durationMs: Date.now() - startedAt, toolCalls }, "Agent stream completed");
    } catch (error) {
      if (res.destroyed || res.writableEnded || (controller.signal.aborted && !timedOut)) return;
      const status = error instanceof GeminiAgentApiError ? error.status : undefined;
      req.log.error({ event: "agent.stream.failed", provider: "gemini", model: activeModel, status, timedOut, durationMs: Date.now() - startedAt }, "Agent stream failed");
      const message = timedOut
        ? "Nexo Agent timed out. Your partial answer is kept; please try again."
        : error instanceof AgentPublicError
          ? error.message
          : error instanceof GeminiAgentApiError
            ? geminiAgentErrorMessage(error.status)
            : "Nexo Agent could not complete this request. Please try again.";
      try {
        await writeChatEvent(res, { activity: { id: "agent-finished", label: "Agent run was interrupted", kind: "info", status: "error" } }, AbortSignal.timeout(5000));
        await writeChatEvent(res, { error: message }, AbortSignal.timeout(5000));
        res.end();
      } catch {
        res.destroy();
      }
    } finally {
      clearTimeout(deadline);
      clearTimeout(idle);
      controller.abort();
      if (heartbeat) clearInterval(heartbeat);
      res.off("close", abortOnDisconnect);
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  });

  return router;
}

export default createAgentRouter();
