import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  buildGeminiAgentRequest, collectAgentResponse, GEMINI_AGENT_MODEL,
  requestGeminiAgentStream, validateAgentHistory,
} from "../src/lib/gemini-agent.ts";
import { createAgentRouter } from "../src/routes/agent.ts";

const input = {
  messages: [{ role: "user", content: "What changed in the latest release?" }],
  timeZone: "America/Chicago",
};

function modelEvent(parts) {
  return { candidates: [{ content: { parts } }] };
}

function geminiResponse(events, status = 200) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

function createSseApp({ getApiKey = () => "test-only-key", fetchImpl, search } = {}) {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", createAgentRouter({
    getApiKey,
    fetchImpl,
    search,
    now: () => new Date("2026-11-06T18:30:00Z"),
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

async function readEvents(response) {
  return (await response.text()).split(/\r?\n/).filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

test("Agent request uses the supported Gemini model, current time, and selected thinking level", () => {
  const request = buildGeminiAgentRequest({ ...input, deepthink: true }, new Date("2026-11-06T18:30:00Z"));
  assert.equal(GEMINI_AGENT_MODEL, "gemini-3.8-flash");
  assert.equal(request.generationConfig.thinkingConfig.thinkingLevel, "high");
  assert.equal(request.toolConfig.functionCallingConfig.mode, "AUTO");
  assert.match(request.systemInstruction.parts[0].text, /2026-11-06T18:30:00\.000Z/);
  assert.match(request.systemInstruction.parts[0].text, /America\/Chicago/);
  assert.match(request.systemInstruction.parts[0].text, /Do not expose private chain-of-thought/);
  const normal = buildGeminiAgentRequest({ ...input, deepthink: false });
  assert.equal(normal.generationConfig.thinkingConfig.thinkingLevel, "medium");
});

test("Agent request keeps the key in a header and preserves function call IDs and signatures", async () => {
  let captured;
  const history = [{
    tool: "run_code",
    callId: "call-1",
    thoughtSignature: "opaque-signature",
    arguments: { language: "javascript", code: "console.log('ok')" },
    result: "stdout: ok",
  }];
  const request = buildGeminiAgentRequest({ ...input, agentHistory: history });
  await requestGeminiAgentStream("test-only-key", request, new AbortController().signal, async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return new Response("", { status: 200 });
  });
  assert.equal(new URL(captured.url).searchParams.has("key"), false);
  assert.equal(captured.init.headers["x-goog-api-key"], "test-only-key");
  const modelCall = captured.body.contents.at(-2).parts[0];
  const functionResult = captured.body.contents.at(-1).parts[0].functionResponse;
  assert.equal(modelCall.functionCall.id, "call-1");
  assert.equal(modelCall.thoughtSignature, "opaque-signature");
  assert.equal(functionResult.id, "call-1");
  assert.equal(functionResult.response.result, "stdout: ok");
});

test("Agent decoder omits private thought text and validates bounded tool history", () => {
  const response = collectAgentResponse([
    modelEvent([
      { text: "private reasoning", thought: true },
      { text: "Visible answer." },
    ]),
  ]);
  assert.equal(response.text, "Visible answer.");
  assert.deepEqual(response.calls, []);
  assert.equal(validateAgentHistory([]), null);
  assert.match(validateAgentHistory([{
    tool: "run_code", callId: "x", thoughtSignature: "sig",
    arguments: { language: "powershell", code: "Write-Host 1" }, result: "no",
  }]), /code history/);
  assert.match(validateAgentHistory([{
    tool: "web_search", callId: "x", thoughtSignature: "sig",
    arguments: { query: "news" }, result: "x".repeat(8_001),
  }]), /invalid or too large/);
});

test("Agent route reports missing Gemini configuration without making an upstream call", async () => {
  let calls = 0;
  await withServer(createSseApp({
    getApiKey: () => undefined,
    fetchImpl: async () => { calls++; return new Response(""); },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /GEMINI_API_KEY/);
  });
  assert.equal(calls, 0);
});

test("Agent searches only when the model requests it and continues with bounded public sources", async () => {
  const requests = [];
  const searches = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (requests.length === 1) {
      return geminiResponse([modelEvent([{
        functionCall: { name: "web_search", id: "search-1", args: { query: "latest release notes" } },
        thoughtSignature: "search-signature",
      }])]);
    }
    return geminiResponse([modelEvent([{ text: "The latest release changed the interface." }])]);
  };
  await withServer(createSseApp({
    fetchImpl,
    search: async (query) => {
      searches.push(query);
      return {
        context: "Release notes published recently.",
        sources: [
          { title: "Release notes", url: "https://example.com/releases/latest" },
          { title: "Private target", url: "http://127.0.0.1/private" },
        ],
      };
    },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 200);
    const events = await readEvents(response);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "The latest release changed the interface.");
    assert.equal(events.some((event) => event.sources?.some((source) => source.url === "http://127.0.0.1/private")), false);
    assert.equal(events.at(-1).done, true);
  });
  assert.deepEqual(searches, ["latest release notes"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers["x-goog-api-key"], "test-only-key");
  assert.equal(requests[1].body.contents.at(-2).parts[0].thoughtSignature, "search-signature");
  assert.equal(requests[1].body.contents.at(-1).parts[0].functionResponse.response.result, "Release notes published recently.");
});

test("Agent sends code requests to the browser client and accepts its bounded execution result", async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length === 1) {
      return geminiResponse([modelEvent([{
        functionCall: { name: "run_code", id: "code-1", args: { language: "javascript", code: "console.log('agent-ok')" } },
        thoughtSignature: "code-signature",
      }])]);
    }
    return geminiResponse([modelEvent([{ text: "The browser run printed agent-ok." }])]);
  };
  await withServer(createSseApp({ fetchImpl }), async (url) => {
    const first = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const firstEvents = await readEvents(first);
    const toolEvent = firstEvents.find((event) => event.agentTool)?.agentTool;
    assert.deepEqual(toolEvent.arguments, { language: "javascript", code: "console.log('agent-ok')" });
    assert.equal(firstEvents.at(-1).done, true);

    const continued = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        agentHistory: [{
          tool: "run_code",
          callId: toolEvent.callId,
          thoughtSignature: toolEvent.thoughtSignature,
          arguments: toolEvent.arguments,
          result: "stdout: agent-ok",
        }],
      }),
    });
    const continuationEvents = await readEvents(continued);
    assert.equal(continuationEvents.filter((event) => event.content).map((event) => event.content).join(""), "The browser run printed agent-ok.");
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].contents.at(-2).parts[0].functionCall.id, "code-1");
  assert.equal(requests[1].contents.at(-2).parts[0].thoughtSignature, "code-signature");
  assert.equal(requests[1].contents.at(-1).parts[0].functionResponse.response.result, "stdout: agent-ok");
});

test("Agent reuses prior search and code results instead of repeating tool side effects", async () => {
  const requests = [];
  let searchCalls = 0;
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) {
      return geminiResponse([modelEvent([{
        functionCall: { name: "web_search", id: "search-first", args: { query: "release details" } },
        thoughtSignature: "sig-search-first",
      }])]);
    }
    if (requests.length === 2) {
      return geminiResponse([modelEvent([{
        functionCall: { name: "web_search", id: "search-repeat", args: { query: "release details" } },
        thoughtSignature: "sig-search-repeat",
      }])]);
    }
    if (requests.length === 3) {
      return geminiResponse([modelEvent([{
        functionCall: { name: "run_code", id: "code-first", args: { language: "javascript", code: "console.log(2 + 2)" } },
        thoughtSignature: "sig-code-first",
      }])]);
    }
    if (requests.length === 4) {
      return geminiResponse([modelEvent([{
        functionCall: { name: "run_code", id: "code-repeat", args: { language: "javascript", code: "console.log(2 + 2)" } },
        thoughtSignature: "sig-code-repeat",
      }])]);
    }
    return geminiResponse([modelEvent([{ text: "I reused both earlier results." }])]);
  };
  await withServer(createSseApp({
    fetchImpl,
    search: async () => {
      searchCalls++;
      return { context: "Release details.", sources: [{ title: "Release", url: "https://example.com/release" }] };
    },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        agentHistory: [{
          tool: "run_code",
          callId: "earlier-code",
          thoughtSignature: "sig-earlier-code",
          arguments: { language: "javascript", code: "console.log(2 + 2)" },
          result: "stdout: 4",
        }],
      }),
    });
    const events = await readEvents(response);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "I reused both earlier results.");
    assert.equal(events.some((event) => event.agentTool), false, "duplicate code must not be sent back to the browser");
  });
  assert.equal(searchCalls, 1, "duplicate search does not scrape twice");
  assert.equal(requests.length, 5);
  assert.match(requests[2].contents.at(-1).parts[0].functionResponse.response.result, /previous result/);
  assert.match(requests[4].contents.at(-1).parts[0].functionResponse.response.result, /already ran/);
});

test("Agent reports unavailable search without claiming facts were verified", async () => {
  let calls = 0;
  await withServer(createSseApp({
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? geminiResponse([modelEvent([{
          functionCall: { name: "web_search", id: "search-error", args: { query: "current event" } },
          thoughtSignature: "search-error-signature",
        }])])
        : geminiResponse([modelEvent([{ text: "I could not verify current details because web search was unavailable." }])]);
    },
    search: async () => { throw new Error("internal scraper detail"); },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const events = await readEvents(response);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "I could not verify current details because web search was unavailable.");
    assert.equal(events.some((event) => event.activity?.status === "error" && event.activity.kind === "search"), true);
    assert.equal(events.some((event) => JSON.stringify(event).includes("internal scraper detail")), false);
  });
});

test("Agent sanitizes provider errors instead of exposing upstream bodies", async () => {
  for (const [status, expected] of [[401, /could not authorize/], [429, /temporarily rate-limited/]]) {
    await withServer(createSseApp({
      fetchImpl: async () => new Response("SENSITIVE_PROVIDER_BODY", { status }),
    }), async (url) => {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const body = await response.text();
      assert.match(body, expected);
      assert.equal(body.includes("SENSITIVE_PROVIDER_BODY"), false);
    });
  }
});

test("closing the Agent response aborts the in-flight Gemini request", async () => {
  let upstreamSignal;
  await withServer(createSseApp({
    fetchImpl: async (_url, init) => {
      upstreamSignal = init.signal;
      let source;
      const body = new ReadableStream({
        start(controller) {
          source = controller;
          init.signal.addEventListener("abort", () => {
            try { source.close(); } catch { /* The response may already have closed. */ }
          }, { once: true });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  }), async (url) => {
    const controller = new AbortController();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /gemini-3\.8-flash/);
    for (let attempt = 0; attempt < 50 && !upstreamSignal; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(upstreamSignal, "Gemini request was started");
    controller.abort();
    for (let attempt = 0; attempt < 50 && !upstreamSignal.aborted; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(upstreamSignal.aborted, true);
    await reader.cancel().catch(() => {});
  });
});
