import { Router, type Request } from "express";
import { EmbedAgentMemoryBody, EmbedAgentMemoryResponse } from "@workspace/api-zod";
import { FeedbackTimeoutError, withFeedbackBudget } from "../lib/feedback-budget";
import { getPublicProviderKey, isPublicApiRequest } from "../lib/public-api-keys";

export const GEMINI_MEMORY_MODEL = "gemini-embedding-2";
export const MEMORY_DIMENSIONS = 768;
class MemoryProviderError extends Error {
  constructor(readonly status: number) { super("Gemini memory request failed"); }
}

/** Each text needs its own embedContent call: Embedding 2 aggregates multi-input content. */
export async function embedAgentMemoryTexts(
  texts: string[], apiKey: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const vectors: number[][] = new Array(texts.length);
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(3, texts.length) }, async () => {
      while (next < texts.length) {
        controller.signal.throwIfAborted();
        const index = next++;
        const response = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MEMORY_MODEL}:embedContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              model: `models/${GEMINI_MEMORY_MODEL}`,
              content: { parts: [{ text: texts[index] }] },
              outputDimensionality: MEMORY_DIMENSIONS,
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new MemoryProviderError(response.status);
        }
        const text = await response.text();
        if (text.length > 80_000) throw new Error("Invalid memory vector");
        const body = JSON.parse(text) as { embedding?: { values?: unknown } };
        const values = body?.embedding?.values;
        if (!Array.isArray(values) || values.length !== MEMORY_DIMENSIONS ||
            !values.every((value) => typeof value === "number" && Number.isFinite(value)) ||
            !values.some((value) => value !== 0)) throw new Error("Invalid memory vector");
        vectors[index] = values;
      }
    }));
    return vectors;
  } finally {
    controller.abort();
    signal.removeEventListener("abort", abort);
  }
}

export function createAgentMemoryRouter({
  getApiKey, fetchImpl = fetch, timeoutMs = 20_000,
}: {
  getApiKey: (request?: Request) => string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const router = Router();
  router.post(["/agent/memory/embed", "/public/agent/memory/embed"], async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = EmbedAgentMemoryBody.safeParse(req.body);
    if (!parsed.success || parsed.data.texts.reduce((sum, text) => sum + text.length, 0) > 96_000) {
      res.status(400).json({ error: "Conversation memory input is invalid or too large." });
      return;
    }
    const publicApi = isPublicApiRequest(req);
    const apiKey = publicApi ? getPublicProviderKey(req, "gemini") : getApiKey(req);
    if (!apiKey) {
      res.status(publicApi ? 401 : 503).json({ error: "Gemini Embedding 2 memory needs a configured Gemini API key. Recent conversation context is still available." });
      return;
    }
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", disconnect);
    try {
      const vectors = await withFeedbackBudget(
        (signal) => embedAgentMemoryTexts(parsed.data.texts, apiKey, signal, fetchImpl),
        controller.signal, timeoutMs,
      );
      if (controller.signal.aborted) return;
      res.json(EmbedAgentMemoryResponse.parse({ model: GEMINI_MEMORY_MODEL, vectors }));
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = error instanceof MemoryProviderError ? error.status : undefined;
      const timedOut = error instanceof FeedbackTimeoutError;
      req.log?.warn({ event: "agent.memory.unavailable", model: GEMINI_MEMORY_MODEL, status, timedOut },
        "Semantic memory unavailable; recent context remains usable");
      res.status(timedOut ? 504 : status === 429 ? 429 : 503).json({
        error: status === 401 || status === 403 || status === 404
          ? "Gemini Embedding 2 is not accessible with this Gemini API key. Recent context will be used instead."
          : "Semantic memory is temporarily unavailable. Recent context will be used instead.",
      });
    } finally {
      res.off("close", disconnect);
    }
  });
  return router;
}
