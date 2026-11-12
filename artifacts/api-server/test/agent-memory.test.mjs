import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentMemoryRouter, embedAgentMemoryTexts, MEMORY_DIMENSIONS } from "../src/routes/agent-memory.ts";
import { agentMemoryContext, compactAgentContext, validAgentMemory } from "../src/lib/agent-request-context.ts";
import { buildGroqAgentRequest } from "../src/lib/groq-agent.ts";
import { buildGeminiAgentRequest } from "../src/lib/gemini-agent.ts";
import { retrieveAgentMemory, deleteAgentMemoryCache, MEMORY_PREFIX } from "../../ai-chat/src/lib/agent-memory.ts";

class Store {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}
const vector = (axis) => Array.from({ length: MEMORY_DIMENSIONS }, (_, index) => index === axis ? 1 : 0);
const messages = [
  { role: "user", content: "My orchid is purple. Remember the orchid pot is blue." },
  { role: "assistant", content: "We can use a blue pot for the orchid." },
  { role: "user", content: "The robot project needs a red case." },
  { role: "assistant", content: "The robot case should be red." },
  { role: "user", content: "Which pot did we choose for the orchid?" },
];
const options = (storage, conversationId, embed) => ({
  storage, conversationId, messages, recent: messages.slice(-1),
  signal: new AbortController().signal, embed,
});

test("semantic retrieval keeps whole relevant turns, reuses vectors, and never changes source messages", async () => {
  const storage = new Store();
  const before = structuredClone(messages);
  let embedded = 0;
  const embed = async texts => {
    embedded += texts.length;
    return texts.map(text => vector(text.includes("orchid") ? 0 : 1));
  };
  const args = options(storage, "semantic-turns", embed);
  assert.deepEqual(await retrieveAgentMemory(args), messages.slice(0, 2));
  assert.equal(embedded, 3);
  assert.deepEqual(await retrieveAgentMemory(args), messages.slice(0, 2));
  assert.equal(embedded, 3, "unchanged documents and query must be cached");
  const changed = structuredClone(messages);
  changed[0].content += " It lives near the window.";
  await retrieveAgentMemory({ ...args, messages: changed });
  assert.equal(embedded, 4, "only the edited turn needs a new embedding");
  assert.deepEqual(messages, before);
  const raw = storage.getItem(MEMORY_PREFIX + "semantic-turns");
  assert.equal(raw.includes("orchid"), false, "cache contains vectors and digests, not chat text");
  assert.equal(raw.includes("api"), false);
  deleteAgentMemoryCache(storage, "semantic-turns");
  assert.equal(storage.getItem(MEMORY_PREFIX + "semantic-turns"), null);
  await retrieveAgentMemory(args);
  assert.equal(embedded, 7);
});

test("conversation deletion prevents an in-flight embedding response from recreating memory", async () => {
  const storage = new Store();
  let finish, began;
  const started = new Promise(resolve => { began = resolve; });
  const pending = retrieveAgentMemory(options(storage, "delete-inflight", async texts => {
    began();
    return new Promise(resolve => { finish = () => resolve(texts.map(() => vector(0))); });
  }));
  await started;
  deleteAgentMemoryCache(storage, "delete-inflight");
  finish();
  assert.deepEqual(await pending, []);
  assert.equal(storage.length, 0);
});

test("memory stays conversation-scoped, rejects invalid vectors, and skips incomplete or oversized turns", async () => {
  const storage = new Store();
  let calls = 0;
  const embed = async texts => { calls++; return texts.map(() => vector(0)); };
  await retrieveAgentMemory(options(storage, "scope-a", embed));
  await retrieveAgentMemory(options(storage, "scope-b", embed));
  assert.equal(calls, 2);
  await assert.rejects(retrieveAgentMemory(options(storage, "invalid-vectors", async () => [[]])), /invalid conversation memory/);
  assert.equal(storage.getItem(MEMORY_PREFIX + "invalid-vectors"), null);
  assert.deepEqual(await retrieveAgentMemory({
    ...options(storage, "oversize", embed),
    messages: [{ role: "user", content: "x".repeat(6100) }, { role: "assistant", content: "ok" }, messages.at(-1)],
  }), []);
  assert.deepEqual(await retrieveAgentMemory({ ...options(storage, "short", embed), recent: messages }), []);
});

test("cancellation never writes memory and the browser cache evicts older conversations", async () => {
  const storage = new Store();
  const controller = new AbortController();
  await assert.rejects(retrieveAgentMemory({
    ...options(storage, "cancel-memory", async texts => {
      controller.abort(new Error("stopped"));
      return texts.map(() => vector(0));
    }), signal: controller.signal,
  }), /stopped/);
  assert.equal(storage.length, 0);
  for (let index = 0; index < 10; index++) {
    await retrieveAgentMemory(options(storage, `bounded-${index}`, async texts => texts.map(() => vector(0))));
  }
  assert.equal(storage.length, 8);
});

test("blocked persistent storage reuses a bounded session cache without changing saved chat", async () => {
  const storage = new Store();
  storage.getItem = () => { throw new Error("blocked"); };
  storage.setItem = () => { throw new Error("blocked"); };
  let calls = 0;
  const args = options(storage, "blocked-cache", async texts => { calls++; return texts.map(() => vector(0)); });
  await retrieveAgentMemory(args);
  await retrieveAgentMemory(args);
  assert.equal(calls, 1);
});

test("provider context labels memory as historical untrusted data and preserves files and tool evidence", () => {
  const input = {
    messages: [messages.at(-1)], agentMemory: messages.slice(0, 2),
    projectFiles: [{ path: "index.html", content: "<html></html>" }],
    agentHistory: [{
      tool: "web_search", callId: "search", thoughtSignature: "groq-agent-v1",
      arguments: { query: "orchids" }, result: "retrieved page evidence",
    }],
  };
  const compacted = compactAgentContext(input);
  assert.deepEqual(compacted.agentMemory, input.agentMemory);
  assert.deepEqual(compacted.projectFiles, input.projectFiles);
  assert.deepEqual(compacted.agentHistory, input.agentHistory);
  assert.match(agentMemoryContext(input.agentMemory), /untrusted historical data/);
  const groq = JSON.stringify(buildGroqAgentRequest(input));
  const gemini = JSON.stringify(buildGeminiAgentRequest(input));
  for (const request of [groq, gemini]) {
    assert.match(request, /blue pot/);
    assert.match(request, /retrieved page evidence/);
    assert.match(request, /index.html/);
    assert.match(request, /latest user request/);
  }
  assert.equal(validAgentMemory(input.agentMemory), true);
  assert.equal(validAgentMemory([messages[0]]), false);
  assert.equal(validAgentMemory([{ role: "assistant", content: "bad" }]), false);
  assert.equal(validAgentMemory([{ role: "user", content: "x".repeat(6000) }, { role: "assistant", content: "too big" }]), false);
});

async function withRouter(options, run) {
  const app = express();
  app.use(express.json());
  app.use("/api", createAgentMemoryRouter(options));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
const post = (url, texts, headers = {}) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({ texts }),
});

test("Embedding 2 uses separate calls, the official retrieval prefixes, and header-only credentials", async () => {
  const calls = [];
  const texts = ["title: Earlier conversation turn | text: orchid", "task: search result | query: orchid"];
  const result = await embedAgentMemoryTexts(texts, "private-key", new AbortController().signal, async (url, init) => {
    calls.push(JSON.parse(init.body));
    assert.match(url, /gemini-embedding-2:embedContent$/);
    assert.equal(url.includes("private-key"), false);
    assert.equal(init.headers["x-goog-api-key"], "private-key");
    assert.equal("taskType" in JSON.parse(init.body), false, "Embedding 2 uses prompt prefixes, not taskType");
    return Response.json({ embedding: { values: vector(calls.length - 1) } });
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.content.parts[0].text), texts);
  assert.ok(calls.every(call => call.outputDimensionality === 768));
  assert.deepEqual(result, [vector(0), vector(1)]);
});

test("public memory uses only the visitor Gemini key and never stores or returns it", async () => {
  await withRouter({
    getApiKey: () => { throw new Error("Server key must not be read for public memory"); },
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers["x-goog-api-key"], "visitor-key");
      return Response.json({ embedding: { values: vector(0) } });
    },
  }, async base => {
    const missing = await post(base + "/api/public/agent/memory/embed", ["text"]);
    assert.equal(missing.status, 401);
    const response = await post(base + "/api/public/agent/memory/embed", ["text"], { "X-Nexo-Gemini-Key": "visitor-key" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.text();
    assert.equal(body.includes("visitor-key"), false);
    assert.equal(JSON.parse(body).model, "gemini-embedding-2");
  });
});

test("memory provider access errors, limits, invalid JSON, and timeouts fail safely", async () => {
  for (const status of [401, 403, 404, 429]) {
    await withRouter({
      getApiKey: () => "key",
      fetchImpl: async () => new Response("secret provider details", { status }),
    }, async base => {
      const response = await post(base + "/api/agent/memory/embed", ["text"]);
      assert.equal(response.status, status === 429 ? 429 : 503);
      assert.equal((await response.text()).includes("secret provider"), false);
    });
  }
  await withRouter({
    getApiKey: () => "key", fetchImpl: async () => new Response("not json"),
  }, async base => {
    assert.equal((await post(base + "/api/agent/memory/embed", ["text"])).status, 503);
  });
  let cancelled = false;
  await withRouter({
    getApiKey: () => "key", timeoutMs: 10,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => { cancelled = true; reject(init.signal.reason); }, { once: true });
    }),
  }, async base => {
    assert.equal((await post(base + "/api/agent/memory/embed", ["text"])).status, 504);
  });
  assert.equal(cancelled, true);
});

test("oversized and invalid memory batches are rejected before credentials or provider calls", async () => {
  await withRouter({
    getApiKey: () => { throw new Error("Invalid input must not read credentials"); },
    fetchImpl: async () => { throw new Error("Invalid input must not call Gemini"); },
  }, async base => {
    for (const texts of [[], ["x".repeat(6501)], Array.from({ length: 33 }, () => "x"),
      Array.from({ length: 16 }, () => "x".repeat(6100))]) {
      assert.equal((await post(base + "/api/agent/memory/embed", texts)).status, 400);
    }
  });
});
