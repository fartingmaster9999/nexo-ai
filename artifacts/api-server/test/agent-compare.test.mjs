import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { runCompareAgentMode, AgentCompareError, compareAgentGeminiModel } from "../src/lib/agent-compare.ts";
import { availableGeminiAgentModels, chooseGeminiCodingFinalist, parseCodingDecision, GEMINI_DECISION_MODEL, DECISION_CRITERIA } from "../src/lib/gemini-agent.ts";
import { createAgentRouter } from "../src/routes/agent.ts";
import { CODING_FALLBACK, PRIMARY_MODEL, SMALL_MODEL } from "../src/lib/model-routing.ts";

const input = {
  messages: [{ role: "user", content: "Build a responsive landing page." }],
  deepthink: true,
};

function decision(winner = "qwen", rationale = "The selected draft covers more requested behavior.") {
  const scores = Object.fromEntries(["qwen", "gpt-oss"].map(id => [
    id, Object.fromEntries(DECISION_CRITERIA.map(key => [key, id === winner ? 5 : 4])),
  ]));
  return { winner, rationale, scores };
}
function parsedDecision(winner, rationale) {
  return parseCodingDecision(JSON.stringify(decision(winner, rationale)));
}

function draft(id) {
  return {
    response: {
      text: "",
      calls: [{
        tool: "write_project",
        callId: id,
        thoughtSignature: "test-signature",
        arguments: {
          entrypoint: "index.html",
          files: [{
            path: "index.html",
            content: `<!doctype html><html><head><title>${id}</title></head><body><main><h1>${id}</h1></main></body></html>`,
          }],
        },
      }],
    },
    requestBytes: 128,
  };
}

test("Compare Agent creates three Qwen drafts, two GPT-OSS drafts, self-selects, then uses Gemini", async () => {
  const generated = [];
  const selfReviews = [];
  const progress = [];
  const result = await runCompareAgentMode({
    client: {},
    input,
    geminiApiKey: "never-logged-test-key",
    geminiModel: "gemini-test",
    signal: new AbortController().signal,
    now: () => new Date("2026-11-12T12:00:00Z"),
    onProgress: (update) => progress.push(update),
    dependencies: {
      generateCandidate: async (_client, _input, model, _signal, _now, _security, _compact, temperature) => {
        const id = model === CODING_FALLBACK
          ? `qwen-${generated.filter((entry) => entry.model === CODING_FALLBACK).length + 1}`
          : `gpt-oss-${generated.filter((entry) => entry.model === PRIMARY_MODEL).length + 1}`;
        generated.push({ id, model, temperature });
        return draft(id);
      },
      selectCandidate: async (_client, _input, model, candidates) => {
        selfReviews.push({ model, ids: candidates.map((candidate) => candidate.id) });
        return { id: candidates.at(-1).id, rationale: "The selected draft covers the request." };
      },
      chooseFinalist: async (_key, _model, finalists) => {
        assert.equal(finalists.qwen.response.calls[0].callId, "qwen-3");
        assert.equal(finalists.gptOss.response.calls[0].callId, "gpt-oss-2");
        return parsedDecision("gpt-oss", "The GPT-OSS finalist includes the complete responsive layout.");
      },
    },
  });

  assert.equal(generated.length, 5);
  assert.equal(generated.filter((entry) => entry.model === CODING_FALLBACK).length, 3);
  assert.equal(generated.filter((entry) => entry.model === PRIMARY_MODEL).length, 2);
  assert.equal(new Set(generated.map((entry) => entry.temperature)).size, 5);
  assert.deepEqual(selfReviews.map((review) => review.model).sort(), [CODING_FALLBACK, PRIMARY_MODEL].sort());
  assert.equal(result.model, PRIMARY_MODEL);
  assert.equal(result.response.calls[0].callId, "gpt-oss-2");
  assert.equal(result.qwenCount, 3);
  assert.equal(result.gptOssCount, 2);
  assert.match(result.rationale, /complete responsive layout/);
  assert.ok(progress.some((update) => update.label.includes("Qwen 20/25, GPT-OSS 25/25")));
});

test("Compare Agent stops without applying code when one model produces no usable drafts", async () => {
  let selfReviews = 0;
  let geminiCalled = false;
  await assert.rejects(
    runCompareAgentMode({
      client: {},
      input,
      geminiApiKey: "test",
      geminiModel: "gemini-test",
      signal: new AbortController().signal,
      dependencies: {
        generateCandidate: async (_client, _input, model) => model === CODING_FALLBACK
          ? { response: { text: "not a tool call", calls: [] }, requestBytes: 10 }
          : draft("gpt-oss-1"),
        selectCandidate: async () => { selfReviews++; return { id: "gpt-oss-1", rationale: "" }; },
        chooseFinalist: async () => { geminiCalled = true; return { winner: "gpt-oss", rationale: "" }; },
      },
    }),
    (error) => error instanceof AgentCompareError && /No project changes were applied/.test(error.message),
  );
  assert.equal(selfReviews, 0);
  assert.equal(geminiCalled, false);
});

test("Compare Agent uses remaining drafts after one model request hits a provider limit", async () => {
  let qwenCalls = 0;
  const generatedModels = [];
  let qwenFinalist;
  const result = await runCompareAgentMode({
    client: {},
    input,
    geminiApiKey: "test",
    geminiModel: "gemini-test",
    signal: new AbortController().signal,
    dependencies: {
      generateCandidate: async (_client, _input, model) => {
        generatedModels.push(model);
        if (model === CODING_FALLBACK && ++qwenCalls === 3) {
          throw Object.assign(new Error("private provider text"), { status: 429 });
        }
        return draft(model === CODING_FALLBACK ? `qwen-${qwenCalls}` : `gpt-oss-${generatedModels.filter((id) => id === model).length}`);
      },
      onCandidateFailure: (_model, error) => error.status === 429,
      selectCandidate: async (_client, _input, model, candidates) => {
        if (model === CODING_FALLBACK) qwenFinalist = candidates.at(-1).id;
        return { id: candidates.at(-1).id, rationale: "Complete draft." };
      },
      chooseFinalist: async (_key, _model, finalists) => {
        assert.equal(finalists.qwen.response.calls[0].callId, qwenFinalist);
        return parsedDecision("qwen", "The Qwen draft is complete.");
      },
    },
  });
  assert.equal(generatedModels.filter((model) => model === CODING_FALLBACK).length, 3);
  assert.equal(generatedModels.filter((model) => model === PRIMARY_MODEL).length, 2);
  assert.equal(result.qwenCount, 2);
  assert.equal(result.gptOssCount, 2);
});

test("Gemini judge selects only an allowed finalist and keeps its key out of the URL", async () => {
  const finalist = draft("finalist");
  const result = await chooseGeminiCodingFinalist(
    "secret-test-key",
    GEMINI_DECISION_MODEL,
    {
      messages: input.messages,
      qwen: { response: finalist.response, rationale: "Qwen self-review" },
      gptOss: { response: finalist.response, rationale: "GPT-OSS self-review" },
    },
    new AbortController().signal,
    async (url, init) => {
      assert.match(url, /:generateContent$/);
      assert.ok(url.includes(GEMINI_DECISION_MODEL));
      assert.equal(url.includes("secret-test-key"), false);
      assert.equal(new Headers(init.headers).get("x-goog-api-key"), "secret-test-key");
      const request = JSON.parse(init.body);
      assert.equal(request.generationConfig.responseMimeType, "application/json");
      assert.equal(request.generationConfig.thinkingConfig, undefined);
      assert.equal("tools" in request, false);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [
          { thought: true, text: "private provider reasoning never used" },
          { text: JSON.stringify(decision("qwen", "Qwen better matches the requested layout.")) },
        ] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );
  assert.deepEqual(result, parsedDecision("qwen", "Qwen better matches the requested layout."));
});

test("Decision 1 score validation rejects malformed, incomplete, out-of-range and inconsistent results", () => {
  const invalid = [
    "not json", '{"winner":"qwen","rationale":"No scores"}',
    JSON.stringify({ ...decision(), winner: "unknown" }),
    JSON.stringify({ ...decision(), winner: "gpt-oss" }),
    JSON.stringify({ ...decision(), rationale: "" }),
    JSON.stringify({ ...decision(), extra: "unexpected" }),
  ];
  for (const value of [NaN, 6, -1, 2.5, "5", null]) {
    const body = decision();
    body.scores.qwen.safety = value;
    invalid.push(JSON.stringify(body));
  }
  for (const text of invalid) assert.throws(() => parseCodingDecision(text));
  assert.equal(compareAgentGeminiModel(["gemini-3.8-flash", "gemini-3.8-pro"]), undefined);
  assert.equal(compareAgentGeminiModel(["gemini-3.8-flash", GEMINI_DECISION_MODEL]), GEMINI_DECISION_MODEL);
});

test("Compare Agent refuses another judge and propagates Decision 1 access failures without applying a candidate", async () => {
  const finalist = draft("test");
  const args = {
    messages: input.messages, qwen: { response: finalist.response, rationale: "" },
    gptOss: { response: finalist.response, rationale: "" },
  };
  let called = false;
  await assert.rejects(chooseGeminiCodingFinalist("key", "gemini-3.8-flash", args,
    new AbortController().signal, async () => { called = true; }), /requires gemini-decision-1/);
  assert.equal(called, false);
  for (const status of [401, 403, 404, 429, 503]) {
    await assert.rejects(chooseGeminiCodingFinalist("key", GEMINI_DECISION_MODEL, args,
      new AbortController().signal, async () => new Response("private provider details", { status })),
    error => error.status === status && !error.message.includes("private provider"));
  }
  await assert.rejects(runCompareAgentMode({
    client: {}, input, geminiApiKey: "key", geminiModel: GEMINI_DECISION_MODEL,
    signal: new AbortController().signal,
    dependencies: {
      generateCandidate: async () => draft("valid"),
      selectCandidate: async (_client, _input, _model, candidates) => ({ id: candidates[0].id, rationale: "Valid draft" }),
      chooseFinalist: async () => { throw Object.assign(new Error("private provider body"), { status: 404 }); },
    },
  }), /not available.*No other judge was substituted/);
});

test("Compare Agent preflight does not start drafts when Decision 1 is absent from the account catalog", async () => {
  let drafts = 0;
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json());
  app.use("/api", createAgentRouter({
    getApiKey: () => "key", getGroqClient: () => ({}),
    getGeminiModels: async () => [{ name: "models/gemini-3.8-flash" }],
    generateGroqCandidate: async () => { drafts++; return draft("not-called"); },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/agent`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, compareAgentMode: true }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /requires gemini-decision-1/);
    assert.equal(drafts, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("Decision 1 discovery accepts a bounded scorer but requires non-streaming generateContent support", async () => {
  const model = {
    name: `models/${GEMINI_DECISION_MODEL}`, inputTokenLimit: 32768, outputTokenLimit: 512,
    supportedGenerationMethods: ["generateContent"],
  };
  const found = await availableGeminiAgentModels("decision-catalog-compatible", async () => Response.json({ models: [model] }));
  assert.deepEqual(found, [model]);
  const incompatible = await availableGeminiAgentModels("decision-catalog-stream-only",
    async () => Response.json({ models: [{ ...model, supportedGenerationMethods: ["streamGenerateContent"] }] }));
  assert.deepEqual(incompatible, []);
});

test("invalid or blocked Decision 1 output stops comparison before a winner can be returned", async () => {
  for (const payload of [
    { candidates: [{ content: { parts: [{ text: '{"winner":"qwen"}' }] } }] },
    { candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: JSON.stringify(decision()) }] } }] },
    { candidates: [{ content: { parts: [{ functionCall: { name: "run_code" } }, { text: JSON.stringify(decision()) }] } }] },
  ]) {
    await assert.rejects(runCompareAgentMode({
      client: {}, input, geminiApiKey: "key", geminiModel: GEMINI_DECISION_MODEL,
      signal: new AbortController().signal,
      fetchImpl: async () => Response.json(payload),
      dependencies: {
        generateCandidate: async () => draft("complete"),
        selectCandidate: async (_client, _input, _model, candidates) => ({ id: candidates[0].id, rationale: "Complete draft" }),
      },
    }), error => error instanceof AgentCompareError && /No project changes were applied/.test(error.message));
  }
});

test("Compare Agent Mode rejects requests unless Deepthink is enabled", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", createAgentRouter({
    getApiKey: () => "test-gemini-key",
    getGroqClient: () => undefined,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Build a page" }], compareAgentMode: true, deepthink: false }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /requires Deepthink/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Agent route sends only Gemini's selected coding finalist to the isolated runner", async () => {
  const catalog = [CODING_FALLBACK, PRIMARY_MODEL, SMALL_MODEL].map((id) => ({
    id,
    active: true,
    context_window: 131_072,
    max_completion_tokens: 32_768,
  }));
  const generated = [];
  const selfReviews = [];
  const client = {
    models: { list: async () => ({ data: catalog }) },
    chat: { completions: { create: async (request) => {
      selfReviews.push(request.model);
      const winner = request.model === CODING_FALLBACK ? "qwen-3" : "gpt-oss-2";
      return {
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: JSON.stringify({ winner, rationale: "Most complete." }) } }] };
          yield { choices: [{ delta: {}, finish_reason: "stop" }] };
        },
      };
    } } },
  };
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json());
  app.use("/api", createAgentRouter({
    getApiKey: () => "test-gemini-key",
    getGroqClient: () => client,
    getGroqModels: async () => catalog,
    getGeminiModels: async () => [{ name: GEMINI_DECISION_MODEL }],
    generateGroqCandidate: async (_client, _input, model, _signal, _now, _security, _compact, temperature) => {
      const id = model === CODING_FALLBACK
        ? `qwen-${generated.filter((entry) => entry.model === model).length + 1}`
        : `gpt-oss-${generated.filter((entry) => entry.model === model).length + 1}`;
      generated.push({ model, temperature });
      return draft(id);
    },
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(decision("gpt-oss", "The GPT-OSS draft is more complete.")) }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Build a responsive landing page." }],
        deepthink: true,
        compareAgentMode: true,
      }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    assert.equal(generated.length, 5);
    assert.deepEqual(selfReviews.sort(), [CODING_FALLBACK, PRIMARY_MODEL].sort());
    assert.equal(events.find((event) => event.agentTool)?.agentTool.callId, "gpt-oss-2");
    assert.match(events.find((event) => event.notice?.id === "compare-agent-selection")?.notice.message ?? "", /Qwen 20\/25; GPT-OSS 25\/25. Selected GPT-OSS/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
