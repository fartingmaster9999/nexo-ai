import type Groq from "groq-sdk";

export const PRIMARY_MODEL = "openai/gpt-oss-120b";
export const SMALL_MODEL = "openai/gpt-oss-20b";
export const CODING_FALLBACK = "qwen/qwen3.8-27b";
export const USAGE_LIMIT_MESSAGE = "You have reached your usage limits, please try again later";
export const DOWNGRADE_MESSAGE = "You've hit your usage limits and are being downgraded to a less smart model.";

let catalog: { ids: string[]; expires: number } | undefined;
const cooldowns = new Map<string, number>();

export async function availableModels(client: Groq): Promise<string[]> {
  if (catalog && catalog.expires > Date.now()) return catalog.ids;
  try {
    const result = await client.models.list();
    const ids = result.data.map((model) => model.id);
    catalog = { ids, expires: Date.now() + 600000 };
    return ids;
  } catch {
    // These models were verified against this account; failed discovery never invents a coder model.
    return [PRIMARY_MODEL, SMALL_MODEL, CODING_FALLBACK];
  }
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
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  // Skip repeated failed requests briefly, but never pretend quotas have reset.
  cooldowns.set(model, Date.now() + Math.min(300, Math.max(15, Number.isFinite(seconds) ? seconds : 60)) * 1000);
}

export class UsageLimitError extends Error {
  constructor() { super(USAGE_LIMIT_MESSAGE); }
}

/** Retry only on an actual rate limit, not authentication or generic upstream failures. */
export async function openModelStream<T>(
  models: string[],
  create: (model: string) => Promise<T>,
  onDowngrade: (model: string) => void,
): Promise<{ model: string; stream: T }> {
  for (let index = 0; index < models.length; index++) {
    const model = models[index]!;
    if (isCoolingDown(model)) continue;
    if (index > 0) onDowngrade(model);
    try { return { model, stream: await create(model) }; }
    catch (error) {
      const candidate = error as { status?: number; headers?: Headers };
      if (candidate.status !== 429) throw error;
      markRateLimited(model, candidate.headers?.get?.("retry-after"));
    }
  }
  throw new UsageLimitError();
}
