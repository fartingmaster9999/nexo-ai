import type Groq from "groq-sdk";

export const PRIMARY_MODEL = "openai/gpt-oss-120b";
export const SMALL_MODEL = "openai/gpt-oss-20b";
export const CODING_FALLBACK = "qwen/qwen3.8-27b";
export const PROMPT_GUARD_MODEL = "meta-llama/llama-prompt-guard-2-86m";
export const SAFEGUARD_MODEL = "openai/gpt-oss-safeguard-20b";
export const LLAMA_CLASSIFIER_MODEL = "meta-llama/llama-3.1-8b-instant";
export const LLAMA_SYNTHESIS_MODEL = "meta-llama/llama-3.3-70b-versatile";
export const GEMINI_AGENT_PRIMARY_MODEL = "gemini-3.8-flash";
export const GEMINI_AGENT_FALLBACK_MODEL = "gemini-3.6-flash";
export const USAGE_LIMIT_MESSAGE = "You have reached your usage limits, please try again later";
export const DOWNGRADE_MESSAGE = "The main model is temporarily rate-limited. A lighter model is answering this reply—you can keep chatting.";

export const AGENT_TASKS = [
  "coding",
  "planning",
  "reasoning",
  "fast_worker",
  "document",
  "synthesis",
  "classification",
  "multimodal",
] as const;
export type AgentTask = typeof AGENT_TASKS[number];

export type ProviderModel = {
  id: string;
  active?: boolean;
  context_window?: number;
  max_completion_tokens?: number;
  owned_by?: string;
};

const agentGenerationModels = new Set([
  PRIMARY_MODEL, SMALL_MODEL, CODING_FALLBACK, LLAMA_CLASSIFIER_MODEL, LLAMA_SYNTHESIS_MODEL,
]);

export function agentGenerationModelIds(models: ProviderModel[]): string[] {
  return models
    .filter((model) => agentGenerationModels.has(model.id) &&
      model.context_window !== undefined && model.context_window >= 8192 &&
      model.max_completion_tokens !== undefined && model.max_completion_tokens >= 8192)
    .map((model) => model.id);
}

export function agentSecurityModelIds(models: ProviderModel[]): string[] {
  return models.filter((model) => {
    if (model.id === PROMPT_GUARD_MODEL) {
      return model.context_window !== undefined && model.context_window >= 512 &&
        model.max_completion_tokens !== undefined && model.max_completion_tokens >= 8;
    }
    if (model.id === SAFEGUARD_MODEL) {
      return model.context_window !== undefined && model.context_window >= 8192 &&
        model.max_completion_tokens !== undefined && model.max_completion_tokens >= 512;
    }
    return false;
  }).map((model) => model.id);
}

export type AgentModelRoute = {
  task: AgentTask;
  models: string[];
  preferredModel?: string;
  preferredLabel: string;
  fallback: boolean;
  unavailable: boolean;
};

const geminiPreferredModels: Partial<Record<AgentTask, { models: string[]; label: string }>> = {
  fast_worker: {
    models: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", GEMINI_AGENT_PRIMARY_MODEL],
    label: "Gemini 3.5 Flash-Lite",
  },
  document: {
    models: ["gemma-4-26b-a4b-it", "gemma-4-31b-it", GEMINI_AGENT_PRIMARY_MODEL],
    label: "Gemma 4 26B A4B",
  },
  multimodal: {
    models: ["gemma-4-31b-it", GEMINI_AGENT_PRIMARY_MODEL],
    label: "Gemma 4 31B",
  },
};

const preferredModels: Record<AgentTask, { model?: string; label: string; models: string[] }> = {
  coding: {
    model: CODING_FALLBACK,
    label: "Qwen3.8 27B",
    models: [CODING_FALLBACK, SMALL_MODEL, PRIMARY_MODEL],
  },
  planning: {
    model: PRIMARY_MODEL,
    label: "GPT-OSS 120B",
    models: [PRIMARY_MODEL, SMALL_MODEL, CODING_FALLBACK],
  },
  reasoning: {
    model: SMALL_MODEL,
    label: "GPT-OSS 20B",
    models: [SMALL_MODEL, PRIMARY_MODEL, CODING_FALLBACK],
  },
  fast_worker: {
    label: "Gemini 3.1/3.5 Flash-Lite",
    models: [SMALL_MODEL, PRIMARY_MODEL, CODING_FALLBACK],
  },
  document: {
    label: "Gemma 4 specialist",
    models: [SMALL_MODEL, PRIMARY_MODEL, CODING_FALLBACK],
  },
  synthesis: {
    model: LLAMA_SYNTHESIS_MODEL,
    label: "Llama 3.3 70B",
    models: [LLAMA_SYNTHESIS_MODEL, PRIMARY_MODEL, SMALL_MODEL, CODING_FALLBACK],
  },
  classification: {
    model: LLAMA_CLASSIFIER_MODEL,
    label: "Llama 3.1 8B",
    models: [LLAMA_CLASSIFIER_MODEL, SMALL_MODEL, PRIMARY_MODEL, CODING_FALLBACK],
  },
  multimodal: {
    label: "Gemma 4 multimodal specialist",
    models: [],
  },
};

let catalog: { models: ProviderModel[]; expires: number } | undefined;
let catalogRequest: Promise<ProviderModel[]> | undefined;
const cooldowns = new Map<string, number>();

export async function availableModelCatalog(client: Groq): Promise<ProviderModel[]> {
  if (catalog && catalog.expires > Date.now()) return catalog.models;
  if (catalogRequest) return catalogRequest;
  catalogRequest = (async () => {
    try {
      const result = await client.models.list({ timeout: 5000, maxRetries: 0 });
      const models = result.data
        .filter((model) => typeof model.id === "string" && model.id.length > 0)
        .map((model) => model as ProviderModel)
        .filter((model) => model.active !== false);
      catalog = { models, expires: Date.now() + 600000 };
      return models;
    } catch {
      // A previously observed catalog may be used briefly during provider discovery outages.
      // Never invent models that the configured account has not returned.
      const models = catalog?.models ?? [];
      catalog = { models, expires: Date.now() + 30000 };
      return models;
    }
  })();
  try { return await catalogRequest; } finally { catalogRequest = undefined; }
}

export async function availableModels(client: Groq): Promise<string[]> {
  return (await availableModelCatalog(client)).map((model) => model.id);
}

export function classifyAgentTask(input: {
  messages: Array<{ role: string; content: string }>;
  deepthink?: boolean;
  image?: unknown;
  projectFiles?: unknown[];
}): AgentTask {
  if (input.image) return "multimodal";
  const prompt = input.messages.at(-1)?.content.toLowerCase() ?? "";
  if (input.projectFiles?.length || /\b(code|coding|debug|bug|build|implement|program|script|test|refactor|run|html|javascript|typescript|python)\b/i.test(prompt)) {
    return "coding";
  }
  if (/\b(document|pdf|report|spreadsheet|contract|attachment|file)\b/i.test(prompt)) return "document";
  if (/\b(classify|categorize|label|brief|short summary|one sentence)\b/i.test(prompt)) return "classification";
  if (/\b(synthesize|compare|research|multiple sources|literature review|comprehensive synthesis)\b/i.test(prompt)) return "synthesis";
  if (/\b(plan|planning|roadmap|strategy|complex|tradeoffs|deep analysis)\b/i.test(prompt)) return "planning";
  if (input.deepthink) return "planning";
  if (/\b(quickly|quick answer|fast|in one line)\b/i.test(prompt)) return "fast_worker";
  return "reasoning";
}

export function routeAgentTask(task: AgentTask, ids: string[]): AgentModelRoute {
  const preferred = preferredModels[task];
  const available = new Set(ids);
  const models = preferred.models.filter((model) => available.has(model));
  const preferredAvailable = preferred.model ? available.has(preferred.model) : false;
  return {
    task,
    models,
    ...(preferred.model ? { preferredModel: preferred.model } : {}),
    preferredLabel: preferred.label,
    fallback: !preferredAvailable,
    unavailable: models.length === 0,
  };
}

export function routeGeminiAgentTask(task: AgentTask, ids: string[]): AgentModelRoute {
  const preferred = geminiPreferredModels[task] ?? {
    models: [GEMINI_AGENT_PRIMARY_MODEL, GEMINI_AGENT_FALLBACK_MODEL],
    label: "Gemini Agent model",
  };
  const available = new Set(ids);
  const models = preferred.models.filter((model) => available.has(model));
  return {
    task,
    models,
    preferredModel: preferred.models[0],
    preferredLabel: preferred.label,
    fallback: !available.has(preferred.models[0]!),
    unavailable: models.length === 0,
  };
}

export function isAgentTask(value: unknown): value is AgentTask {
  return typeof value === "string" && (AGENT_TASKS as readonly string[]).includes(value);
}

export function agentTaskLabel(task: AgentTask): string {
  const labels: Record<AgentTask, string> = {
    coding: "Coding and debugging",
    planning: "Complex planning",
    reasoning: "General reasoning",
    fast_worker: "Fast worker",
    document: "Document specialist",
    synthesis: "Research synthesis",
    classification: "Lightweight classification",
    multimodal: "Image and multimodal analysis",
  };
  return labels[task];
}

export function modelLabel(model: string): string {
  const labels: Record<string, string> = {
    [PRIMARY_MODEL]: "GPT-OSS 120B",
    [SMALL_MODEL]: "GPT-OSS 20B",
    [CODING_FALLBACK]: "Qwen3.8 27B",
    [PROMPT_GUARD_MODEL]: "Prompt Guard 2",
    [SAFEGUARD_MODEL]: "GPT-OSS Safeguard 20B",
    [LLAMA_CLASSIFIER_MODEL]: "Llama 3.1 8B",
    [LLAMA_SYNTHESIS_MODEL]: "Llama 3.3 70B",
    "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
    "gemma-4-31b-it": "Gemma 4 31B",
    "gemma-4-26b-a4b-it": "Gemma 4 26B A4B",
    [GEMINI_AGENT_PRIMARY_MODEL]: "Gemini 3.8 Flash",
    [GEMINI_AGENT_FALLBACK_MODEL]: "Gemini 3.6 Flash",
  };
  return labels[model] ?? model;
}

export function chooseModels(ids: string[], coding: boolean): string[] {
  const coder = coding ? ids.find((id) => /coder/i.test(id) && !/guard/i.test(id)) : undefined;
  return [...new Set([coder ?? PRIMARY_MODEL, coding ? CODING_FALLBACK : SMALL_MODEL])]
    .filter((id) => ids.includes(id));
}

export function isCoolingDown(model: string): boolean {
  return (cooldowns.get(model) ?? 0) > Date.now();
}

/**
 * Cooldowns are a routing hint, not proof that a new request will be rejected.
 * If every candidate is cached, recheck just the earliest one, once per request.
 */
export function modelsForRequest(models: string[]): string[] {
  const ready = models.filter((model) => !isCoolingDown(model));
  if (ready.length || !models.length) return ready;
  return [[...models].sort((a, b) => (cooldowns.get(a) ?? 0) - (cooldowns.get(b) ?? 0))[0]!];
}

export function clearRateLimit(model: string): void {
  cooldowns.delete(model);
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
  const raw = candidate?.error?.error?.message ?? candidate?.error?.message;
  const message = typeof raw === "string" ? raw.slice(0, 4000) : "";
  const metric = /\b(TPM|TPD|RPM|RPD|ITPM|OTPM)\b/i.exec(message)?.[1]?.toUpperCase();
  const counter = (name: string): number | null => {
    const text = new RegExp(`\\b${name}\\s*:?\\s*([\\d,]+(?:\\.\\d+)?)`, "i").exec(message)?.[1];
    const value = text ? Number(text.replace(/,/g, "")) : NaN;
    return Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : null;
  };
  const quotaLimit = counter("Limit");
  const quotaUsed = counter("Used");
  const quotaRequested = counter("Requested");
  const requestTooLarge = /request too large/i.test(message) ||
    (metric !== undefined && /^(?:TPM|TPD|ITPM|OTPM)$/.test(metric) &&
      quotaLimit !== null && quotaRequested !== null && quotaRequested > quotaLimit);
  return {
    metric: metric ?? "unknown",
    quotaLimit,
    quotaUsed,
    quotaRequested,
    requestTooLarge,
    retryAfter: candidate?.headers?.get?.("retry-after") ?? null,
    remainingRequests: candidate?.headers?.get?.("x-ratelimit-remaining-requests") ?? null,
    remainingTokens: candidate?.headers?.get?.("x-ratelimit-remaining-tokens") ?? null,
    tokenLimit: candidate?.headers?.get?.("x-ratelimit-limit-tokens") ?? null,
    resetTokens: candidate?.headers?.get?.("x-ratelimit-reset-tokens") ?? null,
  };
}

export function recordRateLimit(model: string, error: unknown) {
  const diagnostics = rateLimitDiagnostics(error);
  // A request that cannot fit is not evidence that a smaller request must wait.
  if (!diagnostics.requestTooLarge) markRateLimited(model, diagnostics.retryAfter);
  else clearRateLimit(model);
  return diagnostics;
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
  if (!models.length) throw new Error("No compatible model is available for this request.");
  for (const model of modelsForRequest(models)) {
    try {
      const stream = await create(model);
      clearRateLimit(model);
      // A fallback notice describes a confirmed usable stream, not a failed attempt.
      if (model !== models[0]) onDowngrade(model);
      return { model, stream };
    }
    catch (error) {
      const candidate = error as { status?: number; headers?: Headers };
      if (candidate.status !== 429) throw error;
      const diagnostics = recordRateLimit(model, error);
      onRateLimit?.(model, diagnostics);
    }
  }
  throw new UsageLimitError();
}
