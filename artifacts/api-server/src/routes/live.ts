import { Router, type IRouter, type Request, type Response } from "express";
import { CreateLiveSessionTokenBody, CreateLiveSessionTokenResponse } from "@workspace/api-zod";
import { getPublicProviderKey, isPublicApiRequest } from "../lib/public-api-keys";
import { GEMINI_LIVE_TOOLS, liveSystemInstruction } from "../lib/live-tools";

export const GEMINI_LIVE_MODEL = "gemini-3.8-live";
export const GEMINI_LIVE_DEEPTHINK_MODEL = "gemini-3.8-live-extended-thinking";
const TOKEN_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_RATE_WINDOW_MS = 60_000;
const TOKEN_RATE_LIMIT = 12;

type RateWindow = { startedAt: number; count: number };
const tokenRateWindows = new Map<string, RateWindow>();

type LiveRouterOptions = {
  getApiKey?: (request?: Request) => string | undefined;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  rateLimit?: number;
  tokenTimeoutMs?: number;
};

function clientKey(request: Request): string {
  const vercelForwardedFor = request.get("x-vercel-forwarded-for");
  const forwarded = vercelForwardedFor?.split(",")[0]?.trim();
  return forwarded || request.ip || request.socket.remoteAddress || "unknown";
}

function isRateLimited(key: string, timestamp: number, limit: number): boolean {
  for (const [entryKey, entry] of tokenRateWindows) {
    if (timestamp - entry.startedAt >= TOKEN_RATE_WINDOW_MS) tokenRateWindows.delete(entryKey);
  }
  if (tokenRateWindows.size > 2_048) {
    const oldest = tokenRateWindows.keys().next().value;
    if (oldest) tokenRateWindows.delete(oldest);
  }
  const window = tokenRateWindows.get(key);
  if (!window || timestamp - window.startedAt >= TOKEN_RATE_WINDOW_MS) {
    tokenRateWindows.set(key, { startedAt: timestamp, count: 1 });
    return false;
  }
  if (window.count >= limit) return true;
  window.count += 1;
  return false;
}

export function createLiveRouter({
  getApiKey = () => process.env.GEMINI_API_KEY,
  fetchImpl = fetch,
  now = () => new Date(),
  rateLimit = TOKEN_RATE_LIMIT,
  tokenTimeoutMs = TOKEN_REQUEST_TIMEOUT_MS,
}: LiveRouterOptions = {}): IRouter {
  const router: IRouter = Router();

  const createToken = async (req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    const parsedOptions = CreateLiveSessionTokenBody.safeParse(req.body ?? {});
    if (!parsedOptions.success) {
      res.status(400).json({ error: "Live session options must contain a boolean Deepthink setting." });
      return;
    }
    const deepthink = parsedOptions.data.deepthink;
    const model = deepthink ? GEMINI_LIVE_DEEPTHINK_MODEL : GEMINI_LIVE_MODEL;
    const publicApi = isPublicApiRequest(req);
    if (isRateLimited(clientKey(req), now().getTime(), rateLimit)) {
      res.status(429).json({ error: "Too many Live sessions were started. Wait a moment and try again." });
      return;
    }

    const apiKey = publicApi ? getPublicProviderKey(req, "gemini") : getApiKey(req);
    if (!apiKey) {
      res.status(publicApi ? 401 : 503).json({
        error: publicApi
          ? "Add a Gemini API key in Settings to use Nexo Live."
          : "Nexo Live is not configured. Please ask the site owner to add a Gemini API key.",
      });
      return;
    }

    const currentTime = now();
    const expiresAt = new Date(currentTime.getTime() + 30 * 60_000).toISOString();
    const newSessionExpiresAt = new Date(currentTime.getTime() + 60_000).toISOString();
    const abortController = new AbortController();
    let timedOut = false;
    let clientDisconnected = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort(new Error("Gemini Live token request timed out"));
    }, tokenTimeoutMs);
    const abortOnDisconnect = () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        abortController.abort(new Error("Client disconnected"));
      }
    };
    req.on("aborted", abortOnDisconnect);
    res.on("close", abortOnDisconnect);

    try {
      const upstream = await fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          uses: 1,
          expireTime: expiresAt,
          newSessionExpireTime: newSessionExpiresAt,
          bidiGenerateContentSetup: {
            // The empty field mask locks the entire setup server-side. The
            // constrained WebSocket ignores the browser's setup configuration.
            // https://ai.google.dev/api/live#AuthToken
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              ...(deepthink ? { thinkingConfig: { thinkingLevel: "high" } } : {}),
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: GEMINI_LIVE_TOOLS,
            systemInstruction: {
              parts: [{ text: liveSystemInstruction(deepthink) }],
            },
          },
        }),
        signal: abortController.signal,
      });

      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => {});
        req.log?.warn(
          { event: "live.token.failed", provider: "gemini", status: upstream.status },
          "Gemini Live token request failed",
        );
        const status = upstream.status === 429 ? 429 : 502;
        res.status(status).json({
          error: status === 429
            ? "Gemini Live is temporarily rate-limited. Try again later."
            : upstream.status === 401 || upstream.status === 403
              ? "Gemini denied Live access. Check that the Gemini API key is valid, unrestricted for this server, and has Live API access."
              : upstream.status === 400 || upstream.status === 404
                ? "Gemini rejected the Live session configuration. Check the API key and that this account has access to the Gemini Live model."
                : "Gemini could not start a Live session. Try again shortly or check the Gemini service status.",
        });
        return;
      }

      const payload: unknown = await upstream.json();
      if (clientDisconnected || res.destroyed) return;
      if (
        typeof payload !== "object" || payload === null ||
        !("name" in payload) || typeof payload.name !== "string" || !payload.name.trim() ||
        payload.name.length > 4096
      ) {
        req.log?.warn({ event: "live.token.invalid_response", provider: "gemini" }, "Gemini returned an invalid Live token response");
        res.status(502).json({ error: "Gemini returned an invalid Live session token. Please try again." });
        return;
      }

      const response = CreateLiveSessionTokenResponse.parse({
        token: payload.name,
        expiresAt: "expireTime" in payload && typeof payload.expireTime === "string" ? payload.expireTime : expiresAt,
        model,
      });
      res.status(200).json(response);
    } catch {
      if (res.destroyed || clientDisconnected) return;
      if (timedOut) {
        res.status(504).json({ error: "Gemini Live took too long to prepare. Please try again." });
        return;
      }
      req.log?.warn({ event: "live.token.failed", provider: "gemini" }, "Gemini Live token request could not be completed");
      res.status(502).json({ error: "Gemini could not prepare a Live session. Please try again." });
    } finally {
      clearTimeout(timeout);
      req.off("aborted", abortOnDisconnect);
      res.off("close", abortOnDisconnect);
    }
  };

  router.post("/live/token", createToken);
  router.post("/public/live/token", createToken);
  return router;
}

const liveRouter = createLiveRouter();
export default liveRouter;
