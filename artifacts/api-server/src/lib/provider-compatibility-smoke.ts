import Groq from "groq-sdk";
import {
  availableGeminiAgentModels,
  buildGeminiAgentRequest,
  requestGeminiAgentStream,
} from "./gemini-agent";
import {
  buildGroqAgentRequest,
  GROQ_AGENT_MODEL,
} from "./groq-agent";
import {
  agentGenerationModelIds,
  CODING_FALLBACK,
  GEMINI_AGENT_PRIMARY_MODEL,
  GEMINI_AGENT_FALLBACK_MODEL,
  LLAMA_SYNTHESIS_MODEL,
  PRIMARY_MODEL,
} from "./model-routing";
import { GeminiSseDecoder } from "./gemini-image";

const GROQ_TARGETS = [
  { id: PRIMARY_MODEL, label: "GPT-OSS 120B" },
  { id: GROQ_AGENT_MODEL, label: "Qwen3.8 27B" },
  { id: LLAMA_SYNTHESIS_MODEL, label: "Llama 3.3 70B" },
] as const;

const GEMINI_TARGETS = [
  { id: GEMINI_AGENT_PRIMARY_MODEL, label: "Gemini 3.8 Flash" },
  { id: GEMINI_AGENT_FALLBACK_MODEL, label: "Gemini 3.6 Flash" },
  { id: "gemma-4-31b-it", label: "Gemma 4 31B" },
] as const;

type GeminiCatalogModel = {
  name?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

type Diagnostic = {
  provider: "groq" | "gemini";
  check: "catalog" | "request_fields";
  model: string;
  status: string;
};

type SmokeOptions = {
  groqApiKey?: string;
  geminiApiKey?: string;
  groqClientFactory?: (apiKey: string) => Groq;
  geminiCatalogLoader?: (
    apiKey: string,
    fetchImpl: typeof fetch,
  ) => Promise<GeminiCatalogModel[]>;
  fetchImpl?: typeof fetch;
  writeLine?: (line: string) => void;
};

function safeStatus(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? `http_${status}`
    : "request_failed";
}

function record(
  writeLine: (line: string) => void,
  diagnostics: Diagnostic[],
  diagnostic: Diagnostic,
): void {
  diagnostics.push(diagnostic);
  writeLine(JSON.stringify(diagnostic));
}

function groqProbeRequest(model: string) {
  const request = buildGroqAgentRequest(
    { messages: [{ role: "user", content: "Reply with OK." }], timeZone: "UTC" },
    new Date("2026-01-01T00:00:00.000Z"),
    true,
    model,
  );
  return {
    ...request,
    messages: [{ role: "user" as const, content: "Reply with OK." }],
    max_completion_tokens: 16,
    stream: false as const,
    tool_choice: "none" as const,
  };
}

function geminiProbeRequest(model: string) {
  const request = buildGeminiAgentRequest(
    { messages: [{ role: "user", content: "Reply with OK." }], timeZone: "UTC" },
    new Date("2026-01-01T00:00:00.000Z"),
    false,
    undefined,
    model,
    "agent",
  );
  request.systemInstruction.parts[0]!.text = "Reply with OK.";
  request.contents = [{ role: "user", parts: [{ text: "Reply with OK." }] }];
  request.generationConfig.maxOutputTokens = 8;
  if (!model.startsWith("gemma-")) request.generationConfig.thinkingConfig = { thinkingLevel: "low" };
  return request;
}

async function consumeGeminiProbe(response: Response): Promise<boolean> {
  if (!response.ok || !response.body) return false;
  const reader = response.body.getReader();
  const decoder = new GeminiSseDecoder();
  let bytesRead = 0;
  try {
    while (bytesRead < 16_384) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > 16_384) return false;
      for (const event of decoder.push(value)) {
        if (!event || typeof event !== "object") continue;
        const candidate = event as { candidates?: unknown; error?: unknown };
        if (candidate.error) return false;
        if (Array.isArray(candidate.candidates) && candidate.candidates.length > 0) return true;
      }
    }
    for (const event of decoder.push()) {
      if (!event || typeof event !== "object") continue;
      const candidate = event as { candidates?: unknown; error?: unknown };
      if (candidate.error) return false;
      if (Array.isArray(candidate.candidates) && candidate.candidates.length > 0) return true;
    }
    return false;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Deliberately opt-in, live provider probes. Inputs and output budgets are fixed;
 * provider error text and generated content are never included in diagnostics.
 */
export async function runProviderCompatibilitySmoke(
  options: SmokeOptions = {},
): Promise<boolean> {
  const groqApiKey = options.groqApiKey ?? process.env.GROQ_API_KEY;
  const geminiApiKey = options.geminiApiKey ?? process.env.GEMINI_API_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;
  const writeLine = options.writeLine ?? ((line: string) => console.log(line));
  const diagnostics: Diagnostic[] = [];
  let successful = true;

  if (!groqApiKey) {
    successful = false;
    for (const target of GROQ_TARGETS) {
      record(writeLine, diagnostics, {
        provider: "groq", check: "catalog", model: target.label, status: "not_configured",
      });
    }
  } else {
    try {
      const client = (options.groqClientFactory ?? ((apiKey) => new Groq({
        apiKey, baseURL: "https://api.groq.com", timeout: 10_000, maxRetries: 0,
      })))(groqApiKey);
      const catalogResponse = await client.models.list({ timeout: 5000, maxRetries: 0 });
      const eligible = new Set(agentGenerationModelIds(
        catalogResponse.data
          .filter((model) => typeof model.id === "string")
          .map((model) => model as { id: string; context_window?: number; max_completion_tokens?: number }),
      ));
      for (const target of GROQ_TARGETS) {
        const listed = eligible.has(target.id);
        record(writeLine, diagnostics, {
          provider: "groq", check: "catalog", model: target.label,
          status: listed ? "available" : "not_listed_or_incompatible",
        });
        if (!listed) {
          successful = false;
          continue;
        }
        try {
          const result = await client.chat.completions.create(groqProbeRequest(target.id));
          const ok = Array.isArray(result.choices) && result.choices.length > 0;
          record(writeLine, diagnostics, {
            provider: "groq", check: "request_fields", model: target.label,
            status: ok ? "ok" : "no_result",
          });
          if (!ok) successful = false;
        } catch (error) {
          successful = false;
          record(writeLine, diagnostics, {
            provider: "groq", check: "request_fields", model: target.label, status: safeStatus(error),
          });
        }
      }
    } catch (error) {
      successful = false;
      for (const target of GROQ_TARGETS) {
        record(writeLine, diagnostics, {
          provider: "groq", check: "catalog", model: target.label, status: safeStatus(error),
        });
      }
    }
  }

  if (!geminiApiKey) {
    successful = false;
    for (const target of GEMINI_TARGETS) {
      record(writeLine, diagnostics, {
        provider: "gemini", check: "catalog", model: target.label, status: "not_configured",
      });
    }
  } else {
    let geminiCatalogStatus = "available";
    let models: GeminiCatalogModel[] = [];
    try {
      const loader = options.geminiCatalogLoader ?? (async (apiKey, requestFetch) => {
        let failedStatus: number | undefined;
        const catalog = await availableGeminiAgentModels(apiKey, async (input, init) => {
          const response = await requestFetch(input, init);
          if (!response.ok) failedStatus = response.status;
          return response;
        });
        if (failedStatus !== undefined) {
          geminiCatalogStatus = `http_${failedStatus}`;
        } else if (!catalog.length) {
          geminiCatalogStatus = "unavailable";
        }
        return catalog;
      });
      models = await loader(geminiApiKey, fetchImpl);
    } catch (error) {
      geminiCatalogStatus = safeStatus(error);
    }
    const discovered = new Set(models.map((model) => model.name?.replace(/^models\//, "")));
    for (const target of GEMINI_TARGETS) {
      const listed = geminiCatalogStatus === "available" && discovered.has(target.id);
      record(writeLine, diagnostics, {
        provider: "gemini", check: "catalog", model: target.label,
        status: listed ? "available" : geminiCatalogStatus === "available"
          ? "not_listed_or_incompatible"
          : geminiCatalogStatus,
      });
      if (!listed) {
        successful = false;
        continue;
      }
      try {
        const request = geminiProbeRequest(target.id);
        const response = await requestGeminiAgentStream(
          geminiApiKey,
          request,
          AbortSignal.timeout(10_000),
          fetchImpl,
          target.id,
        );
        const ok = await consumeGeminiProbe(response);
        record(writeLine, diagnostics, {
          provider: "gemini", check: "request_fields", model: target.label,
          status: ok ? "ok" : response.ok ? "no_result" : `http_${response.status}`,
        });
        if (!ok) successful = false;
      } catch (error) {
        successful = false;
        record(writeLine, diagnostics, {
          provider: "gemini", check: "request_fields", model: target.label, status: safeStatus(error),
        });
      }
    }
  }

  return successful;
}
