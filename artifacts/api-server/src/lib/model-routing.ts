import type Groq from "groq-sdk";

export const PRIMARY_MODEL = "openai/gpt-oss-120b";
export const SMALL_MODEL = "openai/gpt-oss-20b";
export const CODING_FALLBACK = "qwen/qwen3.8-27b";
export const USAGE_LIMIT_MESSAGE = "You have reached your usage limits, please try again later";
export const DOWNGRADE_MESSAGE = "The main model is temporarily rate-limited. A lighter model is answering this reply—you can keep chatting.";

let catalog: { ids: string[]; expires: number } | undefined;
let catalogRequest: Promise<string[]> | undefined;
const cooldowns = new Map<string, number>();

export async function availableModels(client: Groq): Promise<string[]> {
  if (catalog && catalog.expires > Date.now()) return catalog.ids;
  if (catalogRequest) return catalogRequest;
  catalogRequest = (async () => { try {
    const result = await client.models.list({ timeout: 5000, maxRetries: 0 });
    const ids = result.data.map((model) => model.id);
    catalog = { ids, expires: Date.now() + 600000 };
    return ids;
  } catch {
    // These models were verified against this account; failed discovery never invents a coder model.
    const ids = catalog?.ids ?? [PRIMARY_MODEL, SMALL_MODEL, CODING_FALLBACK];
    catalog = { ids, expires: Date.now() + 30000 };
    return ids;
  } })();
  try { return await catalogRequest; } finally { catalogRequest = undefined; }
}

export function chooseModels(ids: string[], coding: boolean): string[] {
  const coder = coding ? ids.find((id) => /coder/i.test(id) && !/guard/i.test(id)) : undefined;
  return [...new Set([coder ?? PRIMARY_MODEL, coding ? CODING_FALLBACK : SMALL_MODEL])]
    .filter((id) => ids.includes(id));
}

export function isCoolingDown(model: string): boolean {
  return (cooldowns.get(model) ?? 0) > Date.now();
}

export function markRateLimited(model: string, retryAfter?: string | null): void {
  const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
  const dateDelay = retryAfter && !Number.isFinite(seconds)
    ? (Date.parse(retryAfter) - Date.now()) / 1000 : NaN;
  const delay = Number.isFinite(seconds) ? seconds : Number.isFinite(dateDelay) ? dateDelay : 1;
  // Honor short provider retry windows instead of inventing a 15–60 second lockout.
  cooldowns.set(model, Date.now() + Math.min(86400, Math.max(0, delay)) * 1000);
}

/** Only allowlisted quota metadata; never log upstream bodies, prompts or credentials. */
export function rateLimitDiagnostics(error: unknown) {
  const candidate = error as { headers?: Headers; error?: { error?: { message?: string }; message?: string } };
  const message = candidate.error?.error?.message ?? candidate.error?.message ?? "";
  const metric = /\b(TPM|TPD|RPM|RPD|ITPM|OTPM)\b/i.exec(message)?.[1]?.toUpperCase();
  return {
    metric: metric ?? "unknown",
    retryAfter: candidate.headers?.get?.("retry-after") ?? null,
    remainingRequests: candidate.headers?.get?.("x-ratelimit-remaining-requests") ?? null,
    remainingTokens: candidate.headers?.get?.("x-ratelimit-remaining-tokens") ?? null,
    tokenLimit: candidate.headers?.get?.("x-ratelimit-limit-tokens") ?? null,
    resetTokens: candidate.headers?.get?.("x-ratelimit-reset-tokens") ?? null,
  };
}

export class UsageLimitError extends Error {
  constructor() { super(USAGE_LIMIT_MESSAGE); }
}

/** Retry only on an actual rate limit, not authentication or generic upstream failures. */
export async function openModelStream<T>(
  models: string[],
  create: (model: string) => Promise<T>,
  onDowngrade: (model: string) => void,
  onRateLimit?: (model: string, diagnostics: ReturnType<typeof rateLimitDiagnostics>) => void,
): Promise<{ model: string; stream: T }> {
  for (let index = 0; index < models.length; index++) {
    const model = models[index]!;
    if (isCoolingDown(model)) continue;
    try {
      const stream = await create(model);
      // A fallback notice describes a confirmed usable stream, not a failed attempt.
      if (index > 0) onDowngrade(model);
      return { model, stream };
    }
    catch (error) {
      const candidate = error as { status?: number; headers?: Headers };
      if (candidate.status !== 429) throw error;
      markRateLimited(model, candidate.headers?.get?.("retry-after"));
      onRateLimit?.(model, rateLimitDiagnostics(error));
    }
  }
  throw new UsageLimitError();
}
