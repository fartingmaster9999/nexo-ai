import test from "node:test";
import assert from "node:assert/strict";
import {
  CODING_FALLBACK,
  GEMINI_AGENT_FALLBACK_MODEL,
  GEMINI_AGENT_PRIMARY_MODEL,
  LLAMA_SYNTHESIS_MODEL,
  PRIMARY_MODEL,
} from "../src/lib/model-routing.ts";
import { runProviderCompatibilitySmoke } from "../src/lib/provider-compatibility-smoke.ts";

const groqCatalog = [PRIMARY_MODEL, CODING_FALLBACK, LLAMA_SYNTHESIS_MODEL].map((id) => ({
  id,
  active: true,
  context_window: 131072,
  max_completion_tokens: 16384,
}));
const geminiCatalog = [
  GEMINI_AGENT_PRIMARY_MODEL,
  GEMINI_AGENT_FALLBACK_MODEL,
  "gemma-4-31b-it",
].map((id) => ({
  name: `models/${id}`,
  supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
  inputTokenLimit: 131072,
  outputTokenLimit: 16384,
}));

function fakeGroq({ failModel } = {}) {
  const requests = [];
  const client = {
    models: { list: async () => ({ data: groqCatalog }) },
    chat: { completions: { create: async (request) => {
      requests.push(request);
      if (request.model === failModel) throw new Error("private key prompt hidden reasoning");
      return { choices: [{ finish_reason: "stop", message: { content: "private generated text" } }] };
    } } },
  };
  return { client, requests };
}

function geminiResponse() {
  return new Response(
    'data: {"candidates":[{"content":{"parts":[{"text":"private generated text"}]}}]}\n\n',
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

test("opt-in smoke probes use bounded, family-specific fields and safe diagnostics", async () => {
  const groq = fakeGroq();
  const geminiRequests = [];
  const output = [];
  const successful = await runProviderCompatibilitySmoke({
    groqApiKey: "test-groq-secret",
    geminiApiKey: "test-gemini-secret",
    groqClientFactory: () => groq.client,
    geminiCatalogLoader: async () => geminiCatalog,
    fetchImpl: async (url, init) => {
      geminiRequests.push({ url: String(url), init, body: JSON.parse(init.body) });
      return geminiResponse();
    },
    writeLine: (line) => output.push(line),
  });

  assert.equal(successful, true);
  assert.equal(groq.requests.length, 3);
  assert.deepEqual(groq.requests.map((request) => request.model), [
    PRIMARY_MODEL, CODING_FALLBACK, LLAMA_SYNTHESIS_MODEL,
  ]);
  for (const request of groq.requests) {
    assert.equal(request.stream, false);
    assert.equal(request.max_completion_tokens, 16);
    assert.equal(request.messages.length, 1);
    assert.equal(request.messages[0].content, "Reply with OK.");
    assert.ok(request.tools?.length);
    assert.equal(request.tool_choice, "none");
  }
  assert.equal(groq.requests[0].reasoning_effort, "medium");
  assert.equal(groq.requests[0].include_reasoning, false);
  assert.equal(groq.requests[0].reasoning_format, undefined);
  assert.equal(groq.requests[1].reasoning_effort, "medium");
  assert.equal(groq.requests[1].reasoning_format, "parsed");
  assert.equal(groq.requests[1].include_reasoning, undefined);
  assert.equal(groq.requests[2].reasoning_effort, undefined);
  assert.equal(groq.requests[2].reasoning_format, undefined);

  assert.equal(geminiRequests.length, 3);
  assert.ok(geminiRequests.every(({ url }) => url.includes(":streamGenerateContent?alt=sse")));
  assert.ok(geminiRequests.every(({ body }) => body.generationConfig.maxOutputTokens === 8));
  const flash = geminiRequests.find(({ url }) => url.includes(GEMINI_AGENT_PRIMARY_MODEL));
  const fallback = geminiRequests.find(({ url }) => url.includes(GEMINI_AGENT_FALLBACK_MODEL));
  const gemma = geminiRequests.find(({ url }) => url.includes("gemma-4-31b-it"));
  assert.equal(flash.body.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(fallback.body.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.equal(gemma.body.generationConfig.thinkingConfig, undefined);
  assert.equal(geminiRequests[0].init.headers["x-goog-api-key"], "test-gemini-secret");

  const diagnostics = output.map((line) => JSON.parse(line));
  assert.equal(diagnostics.length, 12);
  assert.ok(diagnostics.every((item) =>
    ["groq", "gemini"].includes(item.provider) &&
    ["catalog", "request_fields"].includes(item.check) &&
    ["available", "ok"].includes(item.status),
  ));
  const outputText = output.join("\n");
  assert.doesNotMatch(outputText, /test-groq-secret|test-gemini-secret|private/);
});

test("provider errors expose only allowlisted status diagnostics", async () => {
  const groq = fakeGroq({ failModel: CODING_FALLBACK });
  const output = [];
  const successful = await runProviderCompatibilitySmoke({
    groqApiKey: "must-not-print-groq",
    geminiApiKey: "must-not-print-gemini",
    groqClientFactory: () => groq.client,
    geminiCatalogLoader: async () => geminiCatalog,
    fetchImpl: async (url) => {
      if (String(url).includes(`models/${GEMINI_AGENT_FALLBACK_MODEL}:`)) {
        return new Response("private key, prompt, and reasoning", { status: 403 });
      }
      return geminiResponse();
    },
    writeLine: (line) => output.push(line),
  });

  assert.equal(successful, false);
  const diagnostics = output.map((line) => JSON.parse(line));
  assert.ok(diagnostics.some((item) =>
    item.provider === "groq" && item.model === "Qwen3.8 27B" &&
    item.check === "request_fields" && item.status === "request_failed",
  ));
  assert.ok(diagnostics.some((item) =>
    item.provider === "gemini" && item.model === "Gemini 3.6 Flash" &&
    item.check === "request_fields" && item.status === "http_403",
  ));
  assert.doesNotMatch(output.join("\n"), /must-not-print|private|generated text/);
});

test("missing provider credentials skip network requests", async () => {
  const output = [];
  const successful = await runProviderCompatibilitySmoke({
    groqApiKey: "",
    geminiApiKey: "",
    fetchImpl: async () => { throw new Error("network must not be called"); },
    writeLine: (line) => output.push(line),
  });
  assert.equal(successful, false);
  assert.equal(output.length, 6);
  assert.ok(output.every((line) => JSON.parse(line).status === "not_configured"));
});
