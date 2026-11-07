import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  CODING_FALLBACK,
  PRIMARY_MODEL,
  PROMPT_GUARD_MODEL,
  SAFEGUARD_MODEL,
  SMALL_MODEL,
} from "../src/lib/model-routing.ts";
import { createAgentRouter } from "../src/routes/agent.ts";

const catalog = [
  CODING_FALLBACK,
  PRIMARY_MODEL,
  SMALL_MODEL,
  PROMPT_GUARD_MODEL,
  SAFEGUARD_MODEL,
].map((id) => ({
  id,
  active: true,
  context_window: id === PROMPT_GUARD_MODEL ? 512 : 131072,
  max_completion_tokens: id === PROMPT_GUARD_MODEL ? 512 : id === CODING_FALLBACK ? 16384 : 65536,
}));

function createApp(client, search = async () => ({ context: "", sources: [] })) {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", createAgentRouter({
    getApiKey: () => undefined,
    getGroqClient: () => client,
    search,
  }));
  return app;
}

async function withServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/agent`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function eventsFrom(response) {
  return (await response.text()).split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

function toolStream() {
  return (async function* () {
    yield { choices: [{ delta: { tool_calls: [{
      index: 0,
      id: "routed-code-call",
      type: "function",
      function: { name: "run_code", arguments: '{"language":"javascript","code":"console.log(2+2)"}' },
    }] } }] };
  })();
}

function textStream(content) {
  return (async function* () {
    yield { choices: [{ delta: { content } }] };
  })();
}

test("Agent routes coding to Qwen, exposes security signals, and preserves model/task on continuation", async () => {
  const modelRequests = [];
  const securityCalls = [];
  const client = {
    models: { list: async () => ({ data: catalog }) },
    chat: { completions: { create: async (request) => {
      if (request.model === PROMPT_GUARD_MODEL) {
        securityCalls.push("prompt-guard");
        return { choices: [{ message: { content: "0.02" } }] };
      }
      if (request.model === SAFEGUARD_MODEL) {
        securityCalls.push("safeguard");
        return { choices: [{ message: { content: '{"violation":1,"category":"test-signal"}' } }] };
      }
      modelRequests.push(request);
      return modelRequests.length === 1
        ? toolStream()
        : textStream("I ran the approved browser task and checked the result.");
    } } },
  };

  await withServer(createApp(client), async (url) => {
    const firstResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Build and test a small JavaScript example." }] }),
    });
    const firstEvents = await eventsFrom(firstResponse);
    assert.equal(firstResponse.status, 200);
    assert.ok(firstEvents.some((event) => event.model === CODING_FALLBACK));
    assert.ok(firstEvents.some((event) => event.agentTask === "coding"));
    assert.ok(firstEvents.some((event) => event.activity?.label.includes("Safeguard raised a review signal")));
    const tool = firstEvents.find((event) => event.agentTool)?.agentTool;
    assert.equal(tool?.tool, "run_code", "a screen signal does not replace the server-approved sandbox tool");

    const secondResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Build and test a small JavaScript example." }],
        agentProvider: "groq",
        agentModel: CODING_FALLBACK,
        agentTask: "coding",
        agentHistory: [{
          tool: tool.tool,
          callId: tool.callId,
          thoughtSignature: tool.thoughtSignature,
          arguments: tool.arguments,
          result: "stdout: 4",
        }],
      }),
    });
    const secondEvents = await eventsFrom(secondResponse);
    assert.equal(secondEvents.filter((event) => event.content).map((event) => event.content).join(""), "I ran the approved browser task and checked the result.");
  });

  assert.deepEqual(modelRequests.map((request) => request.model), [CODING_FALLBACK, CODING_FALLBACK]);
  assert.equal(modelRequests[1].messages.at(-2).tool_calls[0].id, "routed-code-call");
  assert.equal(modelRequests[1].messages.at(-1).tool_call_id, "routed-code-call");
  assert.deepEqual(securityCalls, ["prompt-guard", "safeguard", "prompt-guard"]);
});

test("Unavailable fast-worker specialists surface their compatible model fallback", async () => {
  const client = {
    models: { list: async () => ({ data: catalog }) },
    chat: { completions: { create: async (request) => {
      if (request.model === PROMPT_GUARD_MODEL) return { choices: [{ message: { content: "0.01" } }] };
      if (request.model === SMALL_MODEL) return textStream("Fast worker fallback answer.");
      throw new Error("unexpected model");
    } } },
  };

  await withServer(createApp(client), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Give me a quick answer in one line." }] }),
    });
    const events = await eventsFrom(response);
    assert.equal(events.find((event) => event.model)?.model, SMALL_MODEL);
    assert.equal(events.find((event) => event.agentTask)?.agentTask, "fast_worker");
    assert.match(events.find((event) => event.notice)?.notice.message ?? "", /preferred Gemini 3\.1\/3\.5 Flash-Lite model is not available/);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "Fast worker fallback answer.");
  });
});

test("Agent rejects image work when no catalog-verified vision provider is configured", async () => {
  let generationCalls = 0;
  const client = {
    models: { list: async () => ({ data: catalog }) },
    chat: { completions: { create: async () => { generationCalls++; return textStream("must not run"); } } },
  };

  await withServer(createApp(client), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Describe the image." }],
        image: {
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLKrQAAAABJRU5ErkJggg==",
        },
      }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /no Gemini vision credential/);
  });
  assert.equal(generationCalls, 0);
});
