import { Router, type IRouter } from "express";
import { StreamImageChatBody } from "@workspace/api-zod";
import { isValidTimeZone } from "../lib/chat-request";
import { requestGeminiWithRetry } from "../lib/gemini-retry";
import { availableGeminiAgentModels } from "../lib/gemini-agent";
import {
  buildGeminiImageRequest, GeminiImageApiError, GeminiSseDecoder, GEMINI_IMAGE_MODEL,
  GEMINI_IMAGE_FALLBACK_MODEL, GEMMA_IMAGE_MODELS,
  geminiImageErrorMessage, requestGeminiImageStream, visibleGeminiText,
} from "../lib/gemini-image";
import { CHAT_DEADLINE_MS, PROVIDER_IDLE_MS, writeChatEvent } from "../lib/chat-runtime";
import { getPublicProviderKey, isPublicApiRequest } from "../lib/public-api-keys";

type ImageChatRouterOptions = {
  getApiKey?: () => string | undefined;
  getGeminiModels?: typeof availableGeminiAgentModels;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export function createImageChatRouter({
  getApiKey = () => process.env.GEMINI_API_KEY,
  getGeminiModels = availableGeminiAgentModels,
  fetchImpl = fetch,
  now = () => new Date(),
}: ImageChatRouterOptions = {}): IRouter {
  const router: IRouter = Router();

  router.post(["/chat/image", "/public/chat/image"], async (req, res): Promise<void> => {
  const parsed = StreamImageChatBody.safeParse(req.body);
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") {
    res.status(400).json({ error: "Please provide a valid prompt and supported image." });
    return;
  }
  const publicApi = isPublicApiRequest(req);
  const apiKey = publicApi ? getPublicProviderKey(req, "gemini") : getApiKey();
  if (!apiKey) {
    if (publicApi) {
      res.status(401).json({ error: "Add a Gemini API key in Settings to analyze images." });
      return;
    }
    res.status(503).json({ error: "Image understanding is not configured. Please ask the site owner to add a Gemini API key." });
    return;
  }
  if (parsed.data.timeZone !== undefined && !isValidTimeZone(parsed.data.timeZone)) {
    res.status(400).json({ error: "The provided timezone is invalid." });
    return;
  }
  try {
    buildGeminiImageRequest(parsed.data, now(), GEMINI_IMAGE_MODEL);
  } catch {
    res.status(400).json({ error: "The image data is invalid. Choose a JPEG, PNG, or WebP image under 3 MB." });
    return;
  }

  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Gemini image request deadline exceeded"));
  }, CHAT_DEADLINE_MS);
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Gemini image stream stalled"));
    }, PROVIDER_IDLE_MS);
  };
  const abortOnDisconnect = () => {
    if (!res.writableEnded) controller.abort(new Error("Client disconnected"));
  };
  res.on("close", abortOnDisconnect);
  const emit = (event: object) => writeChatEvent(res, event, controller.signal);
  let activeModel = GEMINI_IMAGE_MODEL;

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
    await emit({ activity: { id: "image-analysis", label: "Analyzing the attached image", kind: "thinking", status: "running" } });
    resetIdle();

    const catalog = await getGeminiModels(apiKey, fetchImpl).catch(() => []);
    const catalogIds = new Set(catalog.map((model) => model.name?.replace(/^models\//, "") ?? "").filter(Boolean));
    const geminiModels = [GEMINI_IMAGE_MODEL, GEMINI_IMAGE_FALLBACK_MODEL].filter((model) => catalogIds.has(model));
    if (!geminiModels.length) geminiModels.push(GEMINI_IMAGE_MODEL);
    const models = [...GEMMA_IMAGE_MODELS.filter((model) => catalogIds.has(model)), ...geminiModels];
    let upstream: Response | undefined;
    let lastFailureStatus = 503;
    for (const [index, model] of models.entries()) {
      activeModel = model;
      await emit({ model });
      if (index > 0) {
        await emit({ activity: {
          id: "image-analysis",
          label: model.startsWith("gemma-")
            ? "Trying another Gemma model for image understanding"
            : "Gemma could not process this image; trying Gemini vision instead",
          kind: "thinking",
          status: "running",
        } });
      }
      const modelRequest = buildGeminiImageRequest(parsed.data, now(), model);
      try {
        const candidate = await requestGeminiWithRetry(
          () => requestGeminiImageStream(apiKey, modelRequest, controller.signal, fetchImpl, model),
          controller.signal,
        );
        if (candidate.ok && candidate.body) {
          upstream = candidate;
          break;
        }
        lastFailureStatus = candidate.ok ? 502 : candidate.status;
        req.log.warn({
          event: "gemini.image.model_rejected",
          provider: "gemini",
          model,
          status: lastFailureStatus,
          fallbackAvailable: index < models.length - 1,
        }, "Gemini image model rejected the request");
        await candidate.body?.cancel().catch(() => {});
        if (lastFailureStatus === 401 || lastFailureStatus === 403 ||
            ![400, 404, 429, 500, 502, 503, 504].includes(lastFailureStatus) ||
            index === models.length - 1) {
          throw new GeminiImageApiError(lastFailureStatus);
        }
      } catch (error) {
        if (controller.signal.aborted || error instanceof GeminiImageApiError) throw error;
        req.log.warn({
          event: "gemini.image.model_unreachable",
          provider: "gemini",
          model,
          failureKind: error instanceof Error ? error.name : typeof error,
          fallbackAvailable: index < models.length - 1,
        }, "Gemini image model request could not be completed");
        if (index === models.length - 1) throw error;
      }
    }
    if (!upstream) throw new GeminiImageApiError(lastFailureStatus);
    if (!upstream.body) throw new Error("Gemini returned an empty response stream");

    const decoder = new GeminiSseDecoder();
    const reader = upstream.body.getReader();
    let answerChars = 0;
    let hasAnswer = false;
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        resetIdle();
        for (const item of decoder.push(value)) {
          const text = visibleGeminiText(item);
          if (!text) continue;
          const remaining = 100_000 - answerChars;
          if (remaining <= 0) throw new Error("Gemini response exceeded the output limit");
          const visible = text.slice(0, remaining);
          answerChars += visible.length;
          hasAnswer ||= visible.length > 0;
          if (visible) await emit({ content: visible });
          if (visible.length < text.length) throw new Error("Gemini response exceeded the output limit");
        }
      }
      for (const item of decoder.push()) {
        const text = visibleGeminiText(item);
        if (!text) continue;
        const remaining = 100_000 - answerChars;
        if (remaining <= 0) throw new Error("Gemini response exceeded the output limit");
        const visible = text.slice(0, remaining);
        answerChars += visible.length;
        hasAnswer ||= visible.length > 0;
        if (visible) await emit({ content: visible });
        if (visible.length < text.length) throw new Error("Gemini response exceeded the output limit");
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }

    if (!hasAnswer) throw new Error("Gemini returned no visible answer");
    await emit({ activity: { id: "image-analysis", label: "Image analysis complete", kind: "thinking", status: "complete" } });
    await emit({ done: true });
    res.end();
    req.log.info({ event: "gemini.image.completed", model: activeModel, durationMs: Date.now() - startedAt }, "Gemini image response completed");
  } catch (error) {
    if (res.destroyed || res.writableEnded || (controller.signal.aborted && !timedOut)) return;
    const status = error instanceof GeminiImageApiError ? error.status : undefined;
    req.log.error({
      event: "gemini.image.failed",
      model: activeModel,
      status,
      timedOut,
      failureKind: timedOut ? "timeout" : error instanceof GeminiImageApiError ? "gemini_http" : error instanceof Error ? error.name : typeof error,
      durationMs: Date.now() - startedAt,
    }, "Gemini image response failed");
    const message = timedOut
      ? "Image analysis timed out. Your prompt is kept; please try again."
      : error instanceof GeminiImageApiError
        ? geminiImageErrorMessage(error.status)
        : "The image response could not be completed. Your prompt is kept; please try again.";
    const signal = AbortSignal.timeout(5000);
    try {
      await writeChatEvent(res, { activity: { id: "image-analysis", label: "Image analysis interrupted", kind: "thinking", status: "error" } }, signal);
      await writeChatEvent(res, { error: message }, signal);
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

export default createImageChatRouter();
