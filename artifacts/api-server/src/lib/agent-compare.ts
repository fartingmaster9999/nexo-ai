import Groq from "groq-sdk";
import type { AgentChatInput } from "@workspace/api-zod";
import {
  chooseGeminiCodingFinalist,
  type AgentModelResponse,
} from "./gemini-agent";
import {
  generateGroqCodingCandidate,
  scoreGroqCodingCandidate,
  selectGroqCodingCandidate,
  type GroqCodingCandidate,
} from "./groq-agent";
import { CODING_FALLBACK, PRIMARY_MODEL } from "./model-routing";

type Draft = {
  id: string;
  model: string;
  candidate: GroqCodingCandidate;
};

export class AgentCompareError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message);
    this.name = "AgentCompareError";
  }
}

export type AgentCompareProgress = {
  label: string;
  status: "running" | "complete" | "error";
};

type CompareDependencies = {
  generateCandidate?: typeof generateGroqCodingCandidate;
  selectCandidate?: typeof selectGroqCodingCandidate;
  chooseFinalist?: typeof chooseGeminiCodingFinalist;
  onCandidateFailure?: (model: string, error: unknown) => boolean | void;
  onSelfReviewFailure?: (model: string, error: unknown) => void;
  onGeminiFailure?: (model: string, error: unknown) => void;
  shouldSkipModel?: (model: string) => boolean;
};

export async function runCompareAgentMode(options: {
  client: Groq;
  input: AgentChatInput;
  geminiApiKey: string;
  geminiModel: string;
  signal: AbortSignal;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  securityNote?: string;
  onProgress?: (progress: AgentCompareProgress) => Promise<void> | void;
  dependencies?: CompareDependencies;
}): Promise<{
  model: string;
  response: AgentModelResponse;
  requestBytes: number;
  qwenCount: number;
  gptOssCount: number;
  rationale: string;
}> {
  const now = options.now ?? (() => new Date());
  const generateCandidate = options.dependencies?.generateCandidate ?? generateGroqCodingCandidate;
  const selectCandidate = options.dependencies?.selectCandidate ?? selectGroqCodingCandidate;
  const chooseFinalist = options.dependencies?.chooseFinalist ?? chooseGeminiCodingFinalist;
  const candidates: Array<{ id: string; model: string; temperature: number }> = [
    { id: "qwen-1", model: CODING_FALLBACK, temperature: 0.25 },
    { id: "qwen-2", model: CODING_FALLBACK, temperature: 0.5 },
    { id: "qwen-3", model: CODING_FALLBACK, temperature: 0.75 },
    { id: "gpt-oss-1", model: PRIMARY_MODEL, temperature: 0.4 },
    { id: "gpt-oss-2", model: PRIMARY_MODEL, temperature: 0.7 },
  ];
  let completed = 0;
  let validQwen = 0;
  let validGptOss = 0;
  const blockedModels = new Set<string>();
  const settled: Array<Draft | null> = [];
  const runCandidate = async (spec: typeof candidates[number]): Promise<Draft | null> => {
    try {
      if (blockedModels.has(spec.model) || options.dependencies?.shouldSkipModel?.(spec.model)) return null;
      const candidate = await generateCandidate(
        options.client,
        { ...options.input, deepthink: true },
        spec.model,
        options.signal,
        now(),
        options.securityNote,
        false,
        spec.temperature,
      );
      const score = scoreGroqCodingCandidate(options.input, candidate.response);
      const tool = candidate.response.calls[0]?.tool;
      if (score.valid && (tool === "write_project" || tool === "run_code")) {
        if (spec.model === CODING_FALLBACK) validQwen++;
        else validGptOss++;
        return { id: spec.id, model: spec.model, candidate };
      }
      return null;
    } catch (error) {
      if (options.signal.aborted) throw error;
      if (options.dependencies?.onCandidateFailure?.(spec.model, error) === true) {
        blockedModels.add(spec.model);
      }
      return null;
    } finally {
      completed++;
      await options.onProgress?.({
        label: `Compare Agent drafts: ${completed}/5 finished (${validQwen}/3 Qwen and ${validGptOss}/2 GPT-OSS usable)`,
        status: "running",
      });
    }
  };
  // Keep only one Qwen and one GPT-OSS generation in flight at once. This
  // avoids a five-request burst against the same Groq organization's limits.
  for (let index = 0; index < 3; index++) {
    const batch = [candidates[index]!, ...(index < 2 ? [candidates[index + 3]!] : [])];
    settled.push(...await Promise.all(batch.map(runCandidate)));
    if (options.signal.aborted) throw options.signal.reason ?? new Error("Compare Agent Mode was cancelled.");
  }
  if (options.signal.aborted) throw options.signal.reason ?? new Error("Compare Agent Mode was cancelled.");

  const drafts = settled.filter((draft): draft is Draft => draft !== null).sort((a, b) =>
    candidates.findIndex((candidate) => candidate.id === a.id) -
    candidates.findIndex((candidate) => candidate.id === b.id));
  const qwenDrafts = drafts.filter((draft) => draft.model === CODING_FALLBACK);
  const gptOssDrafts = drafts.filter((draft) => draft.model === PRIMARY_MODEL);
  if (!qwenDrafts.length || !gptOssDrafts.length) {
    await options.onProgress?.({
      label: "Compare Agent could not get a usable draft from both models; no code was applied",
      status: "error",
    });
    throw new AgentCompareError(
      "Compare Agent Mode could not get a complete draft from both Qwen and GPT-OSS. No project changes were applied; check the provider limits or try a smaller coding request.",
    );
  }

  await options.onProgress?.({
    label: "Qwen and GPT-OSS are comparing their own drafts",
    status: "running",
  });
  let qwenSelection: { id: string; rationale: string };
  let gptOssSelection: { id: string; rationale: string };
  try {
    const selfReview = async (model: string, selfDrafts: Draft[]) => {
      try {
        return await selectCandidate(
          options.client,
          { ...options.input, deepthink: true },
          model,
          selfDrafts.map((draft) => ({ id: draft.id, response: draft.candidate.response })),
          options.signal,
          now(),
        );
      } catch (error) {
        options.dependencies?.onSelfReviewFailure?.(model, error);
        throw error;
      }
    };
    [qwenSelection, gptOssSelection] = await Promise.all([
      selfReview(CODING_FALLBACK, qwenDrafts),
      selfReview(PRIMARY_MODEL, gptOssDrafts),
    ]);
  } catch (error) {
    if (options.signal.aborted) throw error;
    options.dependencies?.onGeminiFailure?.(options.geminiModel, error);
    await options.onProgress?.({
      label: "A model could not select its best draft; no code was applied",
      status: "error",
    });
    throw new AgentCompareError(
      "Compare Agent Mode could not complete its model self-review. No project changes were applied; try again or turn Compare Agent Mode off.",
    );
  }

  const qwenFinal = qwenDrafts.find((draft) => draft.id === qwenSelection.id);
  const gptOssFinal = gptOssDrafts.find((draft) => draft.id === gptOssSelection.id);
  if (!qwenFinal || !gptOssFinal) {
    throw new AgentCompareError("Compare Agent Mode received an invalid finalist selection. No project changes were applied.");
  }
  await options.onProgress?.({
    label: "Gemini is comparing the Qwen and GPT-OSS finalists",
    status: "running",
  });

  let decision: Awaited<ReturnType<typeof chooseFinalist>>;
  try {
    decision = await chooseFinalist(
      options.geminiApiKey,
      options.geminiModel,
      {
        messages: options.input.messages,
        qwen: { response: qwenFinal.candidate.response, rationale: qwenSelection.rationale },
        gptOss: { response: gptOssFinal.candidate.response, rationale: gptOssSelection.rationale },
      },
      options.signal,
      options.fetchImpl,
    );
  } catch (error) {
    if (options.signal.aborted) throw error;
    await options.onProgress?.({
      label: "Gemini could not choose a finalist; no code was applied",
      status: "error",
    });
    const status = (error as { status?: unknown })?.status;
    throw new AgentCompareError(
      status === 429
        ? "Gemini is temporarily rate-limited, so Compare Agent Mode could not choose a winner. No project changes were applied; try again later."
        : status === 401 || status === 403
          ? "Gemini could not authorize the final comparison. Check the Gemini API key and its model access; no project changes were applied."
          : "Gemini could not complete the final comparison. No project changes were applied; try again or turn Compare Agent Mode off.",
      status === 429 || status === 401 || status === 403 ? status : 503,
    );
  }

  const winner = decision.winner === "qwen" ? qwenFinal : gptOssFinal;
  const rationale = decision.rationale || (decision.winner === "qwen"
    ? qwenSelection.rationale
    : gptOssSelection.rationale);
  await options.onProgress?.({
    label: `Gemini selected ${decision.winner === "qwen" ? "Qwen" : "GPT-OSS"}'s finalist; sending it to the isolated code runner`,
    status: "complete",
  });
  return {
    model: winner.model,
    response: winner.candidate.response,
    requestBytes: winner.candidate.requestBytes,
    qwenCount: qwenDrafts.length,
    gptOssCount: gptOssDrafts.length,
    rationale,
  };
}

export function compareAgentGeminiModel(models: string[]): string | undefined {
  return models.find((model) => model.startsWith("gemini-"));
}
