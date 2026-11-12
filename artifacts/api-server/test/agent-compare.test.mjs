import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { runCompareAgentMode, AgentCompareError } from "../src/lib/agent-compare.ts";
import { chooseGeminiCodingFinalist } from "../src/lib/gemini-agent.ts";
import { createAgentRouter } from "../src/routes/agent.ts";
import { CODING_FALLBACK, PRIMARY_MODEL, SMALL_MODEL } from "../src/lib/model-routing.ts";

const input = {
  messages: [{ role: "user", content: "Build a responsive landing page." }],
  deepthink: true,
};

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
        return { winner: "gpt-oss", rationale: "The GPT-OSS finalist includes the complete responsive layout." };
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
  assert.ok(progress.some((update) => update.label.includes("Gemini selected")));
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
        return { winner: "qwen", rationale: "The Qwen draft is complete." };
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
    "gemini-test",
    {
      messages: input.messages,
      qwen: { response: finalist.response, rationale: "Qwen self-review" },
      gptOss: { response: finalist.response, rationale: "GPT-OSS self-review" },
    },
    new AbortController().signal,
    async (url, init) => {
      assert.match(url, /:generateContent$/);
      assert.equal(url.includes("secret-test-key"), false);
      assert.equal(new Headers(init.headers).get("x-goog-api-key"), "secret-test-key");
      const request = JSON.parse(init.body);
      assert.equal(request.generationConfig.responseMimeType, "application/json");
      assert.equal(request.generationConfig.thinkingConfig.thinkingLevel, "low");
      assert.equal("tools" in request, false);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"winner":"qwen","rationale":"Qwen better matches the requested layout."}' }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  );
  assert.deepEqual(result, { winner: "qwen", rationale: "Qwen better matches the requested layout." });
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
    getGeminiModels: async () => [{ name: "gemini-3.6-flash" }],
    generateGroqCandidate: async (_client, _input, model, _signal, _now, _security, _compact, temperature) => {
      const id = model === CODING_FALLBACK
        ? `qwen-${generated.filter((entry) => entry.model === model).length + 1}`
        : `gpt-oss-${generated.filter((entry) => entry.model === model).length + 1}`;
      generated.push({ model, temperature });
      return draft(id);
    },
    fetchImpl: async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"winner":"gpt-oss","rationale":"The GPT-OSS draft is more complete."}' }] } }],
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
    assert.match(events.find((event) => event.notice?.id === "compare-agent-selection")?.notice.message ?? "", /Gemini selected GPT-OSS/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
