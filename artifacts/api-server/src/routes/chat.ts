import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { StreamChatBody } from "@workspace/api-zod";
import { buildChatRequest, isValidTimeZone } from "../lib/chat-request";
import { buildSearchQuery, isCodingRequest, needsWebSearch } from "../lib/chat-policy";
import { searchWeb } from "../lib/web-search";
import {
  availableModels, chooseModels, openModelStream, PRIMARY_MODEL, SMALL_MODEL,
  UsageLimitError, USAGE_LIMIT_MESSAGE, DOWNGRADE_MESSAGE, markRateLimited,
} from "../lib/model-routing";

const router: IRouter = Router();

router.post("/chat", async (req, res): Promise<void> => {
  const parsed = StreamChatBody.safeParse(req.body);
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") {
    res.status(400).json({ error: "Please provide a valid conversation ending with your message." });
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    res.status(503).json({ error: "Nexo AI is not configured. Please contact the site owner." });
    return;
  }
  if (parsed.data.timeZone !== undefined && !isValidTimeZone(parsed.data.timeZone)) {
    res.status(400).json({ error: "The provided timezone is invalid." });
    return;
  }
  const client = new Groq({
    apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com",
    timeout: 120000, maxRetries: 0,
  });
  const controller = new AbortController();
  const abortOnDisconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", abortOnDisconnect);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let activeModel = PRIMARY_MODEL;
  const emit = (event: object) => {
    if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const activity = (id: string, label: string, kind = "info", status = "complete") =>
    emit({ activity: { id, label, kind, status } });

  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(": keepalive\n\n");
    }, 10000);
    activity("clock", "Current date and time included");

    const lastPrompt = parsed.data.messages.at(-1)!.content;
    const coding = isCodingRequest(lastPrompt);
    let webContext: string | undefined;
    let searchFailed = false;
    if (needsWebSearch(lastPrompt)) {
      activity("search", "Searching the web and reading public pages…", "search", "running");
      try {
        const result = await searchWeb(buildSearchQuery(parsed.data.messages));
        if (controller.signal.aborted) return;
        webContext = result.context;
        emit({ sources: result.sources });
        activity("search", `${result.cached ? "Reused recent" : "Found"} ${result.sources.length} public sources${result.provider === "public-scraper" ? " with the direct scraper" : ""}`, "search");
      } catch {
        if (controller.signal.aborted) return;
        req.log.warn({ service: "web-search" }, "External sources could not be retrieved");
        searchFailed = true;
        activity("search", "Web search unavailable; current facts could not be verified", "search", "error");
      }
    }
    if (controller.signal.aborted) return;
    activity("generating", parsed.data.deepthink ? "Thinking… Deepthink is working" : "Preparing a focused answer", "thinking", "running");

    const ids = coding ? await availableModels(client) : [PRIMARY_MODEL, SMALL_MODEL];
    const candidates = chooseModels(ids, coding);
    const { model, stream } = await openModelStream(
      candidates,
      (candidate) => client.chat.completions.create(
        buildChatRequest(parsed.data, new Date(), { model: candidate, webContext, searchFailed, coding }),
        { signal: controller.signal },
      ),
      (fallback) => emit({ notice: { id: "model-downgrade", message: DOWNGRADE_MESSAGE, model: fallback } }),
    );
    activeModel = model;
    emit({ provider: "groq", model, reasoningEffort: parsed.data.deepthink ? "high" : "medium" });
    let hasContent = false;
    let finishReason: string | null = null;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const content = choice?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        hasContent = true;
        emit({ content });
      }
    }
    if (!hasContent) throw new Error("Empty completion");
    activity("generating", "…done thinking.", "thinking");
    emit(finishReason === "length"
      ? { error: "The response reached its length limit. Ask Nexo AI to continue." }
      : { done: true });
    res.end();
  } catch (error) {
    if (controller.signal.aborted || res.destroyed || res.writableEnded) return;
    const status = error instanceof Groq.APIError ? error.status : undefined;
    req.log.error({ provider: "groq", status }, "Chat request failed");
    if (status === 429) markRateLimited(activeModel);
    const message = status === 429 || error instanceof UsageLimitError ? USAGE_LIMIT_MESSAGE
      : status === 401 || status === 403 ? "Nexo AI could not authorize this request. Please contact the site owner."
        : "The response could not be completed. Please try again.";
    activity("generating", "Response interrupted", "thinking", "error");
    emit({ error: message });
    res.end();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    res.off("close", abortOnDisconnect);
  }
});

export default router;
