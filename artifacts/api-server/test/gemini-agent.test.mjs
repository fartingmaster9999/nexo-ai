import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import {
  buildGeminiAgentRequest, collectAgentResponse, GEMINI_AGENT_MODEL, MAX_AGENT_HTML_PREVIEW_RUNS,
  requestGeminiAgentStream, validateAgentHistory,
} from "../src/lib/gemini-agent.ts";
import { buildGroqAgentRequest, collectGroqAgentResponse, GROQ_AGENT_MODEL } from "../src/lib/groq-agent.ts";
import { CODING_FALLBACK } from "../src/lib/model-routing.ts";
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

function createSseApp({ getApiKey = () => "test-only-key", getGroqClient, fetchImpl, search, providerIdleMs } = {}) {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", createAgentRouter({
    getApiKey,
    getGroqClient,
    fetchImpl,
    search,
    now: () => new Date("2026-11-06T18:30:00Z"),
    providerIdleMs,
  }));
  return app;
}

test("Qwen Agent request enables bounded autonomous build-and-test tools", () => {
  const request = buildGroqAgentRequest({ ...input, deepthink: true }, new Date("2026-11-06T18:30:00Z"));
  assert.equal(GROQ_AGENT_MODEL, CODING_FALLBACK);
  assert.equal(request.model, CODING_FALLBACK);
  assert.equal(request.reasoning_effort, "high");
  assert.equal(request.reasoning_format, "parsed");
  assert.equal(request.tool_choice, "auto");
  assert.equal(request.parallel_tool_calls, false);
  assert.match(request.messages[0].content, /inspect the sandbox output, fix errors, and run it again/);
  assert.deepEqual(request.tools.map((tool) => tool.function.name), ["web_search", "run_code"]);
});

test("Qwen Agent decoder collects streamed tool arguments and rejects invalid JSON", async () => {
  const chunks = async function* () {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "qwen-call", function: { name: "run_code", arguments: "{\"language\":\"javascript\"," } }] } }] };
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"code\":\"console.log(2+2)\"}" } }] } }] };
  };
  const result = await collectGroqAgentResponse(chunks(), new AbortController().signal);
  assert.equal(result.calls[0].tool, "run_code");
  assert.deepEqual(result.calls[0].arguments, { language: "javascript", code: "console.log(2+2)" });
  assert.equal(result.calls[0].thoughtSignature, "groq-agent-v1");
  await assert.rejects(
    collectGroqAgentResponse((async function* () {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "bad", function: { name: "run_code", arguments: "{" } }] } }] };
    })(), new AbortController().signal),
    /invalid Agent tool arguments/,
  );
});

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

test("Agent sends a validated image to Gemini without adding it to tool history", () => {
  const image = {
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLKrQAAAABJRU5ErkJggg==",
  };
  const request = buildGeminiAgentRequest({ ...input, image });
  assert.deepEqual(request.contents[0].parts[1], { inlineData: image });
  assert.match(request.systemInstruction.parts[0].text, /attached image as visual context/);
  const continuation = buildGeminiAgentRequest({
    ...input,
    image,
    agentHistory: [{
      tool: "web_search",
      callId: "search-1",
      thoughtSignature: "opaque-signature",
      arguments: { query: "latest release" },
      result: "Release notes",
    }],
  });
  assert.deepEqual(continuation.contents[0].parts[1], { inlineData: image });
  assert.equal(JSON.stringify(continuation.contents.slice(1)).includes(image.data), false);
  assert.throws(() => buildGeminiAgentRequest({ ...input, image: { ...image, mimeType: "image/jpeg" } }), /Invalid image|match its content/);
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

test("Agent rejects invalid image bytes before contacting Gemini", async () => {
  let calls = 0;
  await withServer(createSseApp({
    fetchImpl: async () => { calls++; return geminiResponse([modelEvent([{ text: "unexpected" }])]); },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, image: { mimeType: "image/png", data: "bm90LWltYWdl" } }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JPEG, PNG, or WebP image under 3 MB/);
  });
  assert.equal(calls, 0);
});

test("Agent retries a transient Gemini 503 once before streaming a successful answer", async () => {
  let calls = 0;
  await withServer(createSseApp({
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response("temporary upstream failure", { status: 503, headers: { "Retry-After": "0" } })
        : geminiResponse([modelEvent([{ text: "Gemini recovered." }])]);
    },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const events = await readEvents(response);
    assert.equal(response.status, 200);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "Gemini recovered.");
  });
  assert.equal(calls, 2);
});

test("Agent visibly switches to the supported fallback model after repeated Gemini 5xx errors", async () => {
  let calls = 0;
  const urls = [];
  let fallbackRequest;
  await withServer(createSseApp({
    fetchImpl: async (url, init) => {
      calls++;
      urls.push(String(url));
      if (calls <= 2) {
        return new Response("temporary upstream failure", { status: 503, headers: { "Retry-After": "0" } });
      }
      fallbackRequest = JSON.parse(init.body);
      return geminiResponse([modelEvent([{ text: "Fallback answer." }])]);
    },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, deepthink: true }),
    });
    const events = await readEvents(response);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "Fallback answer.");
    assert.deepEqual(events.filter((event) => event.model).map((event) => event.model), ["gemini-3.8-flash", "gemini-3.6-flash"]);
    assert.match(events.find((event) => event.notice)?.notice.message ?? "", /switched to Gemini 3\.6 Flash/);
  });
  assert.equal(calls, 3);
  assert.match(urls[0], /models\/gemini-3\.8-flash:/);
  assert.match(urls[2], /models\/gemini-3\.6-flash:/);
  assert.equal(fallbackRequest.generationConfig.thinkingConfig.thinkingLevel, "high");
});

test("Agent switches models when the primary stream stalls before its first event", async () => {
  let calls = 0;
  const urls = [];
  await withServer(createSseApp({
    providerIdleMs: 10,
    fetchImpl: async (url, init) => {
      calls++;
      urls.push(String(url));
      if (calls === 1) {
        return new Response(new ReadableStream({
          start(streamController) {
            const onAbort = () => streamController.error(new Error("provider attempt aborted"));
            if (init.signal.aborted) onAbort();
            else init.signal.addEventListener("abort", onAbort, { once: true });
          },
        }));
      }
      return geminiResponse([modelEvent([{ text: "Recovered after the stall." }])]);
    },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const events = await readEvents(response);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "Recovered after the stall.");
    assert.deepEqual(events.filter((event) => event.model).map((event) => event.model), ["gemini-3.8-flash", "gemini-3.6-flash"]);
    assert.match(events.find((event) => event.notice)?.notice.message ?? "", /switched to Gemini 3\.6 Flash/);
  });
  assert.equal(calls, 2);
  assert.match(urls[0], /models\/gemini-3\.8-flash:/);
  assert.match(urls[1], /models\/gemini-3\.6-flash:/);
});

test("Agent retries the same model after a stalled tool continuation", async () => {
  let calls = 0;
  const urls = [];
  await withServer(createSseApp({
    providerIdleMs: 10,
    fetchImpl: async (url, init) => {
      calls++;
      urls.push(String(url));
      if (calls === 1) {
        return new Response(new ReadableStream({
          start(streamController) {
            const onAbort = () => streamController.error(new Error("provider attempt aborted"));
            if (init.signal.aborted) onAbort();
            else init.signal.addEventListener("abort", onAbort, { once: true });
          },
        }));
      }
      return geminiResponse([modelEvent([{ text: "Continuation recovered." }])]);
    },
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        agentHistory: [{
          tool: "web_search",
          callId: "prior-search",
          thoughtSignature: "prior-signature",
          arguments: { query: "official current release" },
          result: "The official release page lists the current release.",
        }],
      }),
    });
    const events = await readEvents(response);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "Continuation recovered.");
  });
  assert.equal(calls, 2);
  assert.equal(urls.every((url) => url.includes("/models/gemini-3.8-flash:")), true);
});

test("Gemini rate limits switch Agent to Qwen and keep code-tool history on Groq", async () => {
  let geminiCalls = 0;
  const groqRequests = [];
  const groqClient = {
    models: { list: async () => ({ data: [{ id: CODING_FALLBACK }] }) },
    chat: { completions: { create: async (request) => {
      groqRequests.push(request);
      const callNumber = groqRequests.length;
      return (async function* () {
        if (callNumber === 1) {
          yield { choices: [{ delta: { tool_calls: [{
            index: 0,
            id: "qwen-code-1",
            type: "function",
            function: { name: "run_code", arguments: '{"language":"javascript","code":"console.log(2+2)"}' },
          }] } }] };
        } else {
          yield { choices: [{ delta: { content: "I built and tested the code successfully." } }] };
        }
      })();
    } } },
  };
  await withServer(createSseApp({
    fetchImpl: async () => {
      geminiCalls++;
      return new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } });
    },
    getGroqClient: () => groqClient,
  }), async (url) => {
    const firstResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const firstEvents = await readEvents(firstResponse);
    assert.equal(firstResponse.status, 200);
    assert.equal(firstEvents.some((event) => event.agentProvider === "groq"), true);
    assert.match(firstEvents.find((event) => event.notice)?.notice.message ?? "", /Groq Qwen3\.8 27B/);
    const tool = firstEvents.find((event) => event.agentTool)?.agentTool;
    assert.equal(tool.arguments.language, "javascript");

    const continuation = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        agentProvider: "groq",
        agentHistory: [{
          tool: "run_code",
          callId: tool.callId,
          thoughtSignature: tool.thoughtSignature,
          arguments: tool.arguments,
          result: "stdout: 4",
        }],
      }),
    });
    const continuationEvents = await readEvents(continuation);
    assert.equal(continuationEvents.filter((event) => event.content).map((event) => event.content).join(""), "I built and tested the code successfully.");
  });
  assert.equal(geminiCalls, 2, "Gemini is retried once, then the selected fallback handles continuation");
  assert.equal(groqRequests.length, 2);
  assert.equal(groqRequests[0].model, CODING_FALLBACK);
  assert.equal(groqRequests[0].tool_choice, "auto");
  assert.equal(groqRequests[1].messages.at(-2).tool_calls[0].id, "qwen-code-1");
  assert.equal(groqRequests[1].messages.at(-1).tool_call_id, "qwen-code-1");
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
          { title: "Release notes", url: "https://example.com/releases/latest", retrieval: "search_excerpt" },
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
    assert.equal(events.find((event) => event.sources)?.sources[0].retrieval, "search_excerpt");
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
  const image = {
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLKrQAAAABJRU5ErkJggg==",
  };
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, image }),
    });
    const firstEvents = await readEvents(first);
    assert.deepEqual(requests[0].contents[0].parts[1], { inlineData: image });
    assert.equal(JSON.stringify(firstEvents).includes(image.data), false, "image bytes are not returned in Agent events");
    const toolEvent = firstEvents.find((event) => event.agentTool)?.agentTool;
    assert.deepEqual(toolEvent.arguments, { language: "javascript", code: "console.log('agent-ok')" });
    assert.equal(firstEvents.at(-1).done, true);

    const continued = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        image,
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
  assert.deepEqual(requests[1].contents[0].parts[1], { inlineData: image });
  assert.equal(requests[1].contents.at(-2).parts[0].functionCall.id, "code-1");
  assert.equal(requests[1].contents.at(-2).parts[0].thoughtSignature, "code-signature");
  assert.equal(requests[1].contents.at(-1).parts[0].functionResponse.response.result, "stdout: agent-ok");
});

test("Agent caps HTML previews at three runs and returns the limit to the model", async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) {
      return geminiResponse([modelEvent([{
        functionCall: { name: "run_code", id: "html-fourth", args: { language: "html", code: "<h1>Another preview</h1>" } },
        thoughtSignature: "html-fourth-signature",
      }])]);
    }
    return geminiResponse([modelEvent([{ text: "I stopped after the preview limit." }])]);
  };
  const history = Array.from({ length: MAX_AGENT_HTML_PREVIEW_RUNS }, (_, index) => ({
    tool: "run_code",
    callId: `html-${index + 1}`,
    thoughtSignature: `html-signature-${index + 1}`,
    arguments: { language: "html", code: `<h1>Preview ${index + 1}</h1>` },
    result: `Preview ${index + 1} rendered.`,
  }));
  await withServer(createSseApp({ fetchImpl }), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, agentHistory: history }),
    });
    const events = await readEvents(response);
    assert.equal(events.filter((event) => event.content).map((event) => event.content).join(""), "I stopped after the preview limit.");
    assert.equal(events.some((event) => event.agentTool), false, "The fourth HTML tool call is not dispatched to the browser");
    assert.ok(events.some((event) => event.activity?.label === "HTML preview revision limit reached"));
  });
  assert.equal(requests.length, 2);
  assert.match(requests[1].contents.at(-1).parts[0].functionResponse.response.result, /revision limit was reached after three runs/i);
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

test("Agent sanitizes failed image requests without emitting image bytes or provider errors", async () => {
  const image = {
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLKrQAAAABJRU5ErkJggg==",
  };
  const providerError = `SENSITIVE_PROVIDER_BODY:${image.data}`;
  await withServer(createSseApp({
    fetchImpl: async () => new Response(providerError, { status: 401 }),
  }), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, image }),
    });
    const body = await response.text();
    assert.match(body, /could not authorize/);
    assert.equal(body.includes("SENSITIVE_PROVIDER_BODY"), false);
    assert.equal(body.includes(image.data), false, "image bytes are absent from emitted error events");
  });
});

test("cancelling an image-bearing Agent request aborts its in-flight Gemini request", async () => {
  const image = {
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLKrQAAAABJRU5ErkJggg==",
  };
  let upstreamSignal;
  let upstreamBody;
  await withServer(createSseApp({
    fetchImpl: async (_url, init) => {
      upstreamSignal = init.signal;
      upstreamBody = JSON.parse(init.body);
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
      body: JSON.stringify({ ...input, image }),
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    const first = await reader.read();
    const emittedBeforeCancellation = new TextDecoder().decode(first.value);
    assert.match(emittedBeforeCancellation, /gemini-3\.8-flash/);
    assert.equal(emittedBeforeCancellation.includes(image.data), false, "emitted Agent events never contain image bytes");
    for (let attempt = 0; attempt < 50 && !upstreamSignal; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(upstreamSignal, "Gemini request was started");
    assert.deepEqual(upstreamBody.contents[0].parts[1], { inlineData: image });
    controller.abort();
    for (let attempt = 0; attempt < 50 && !upstreamSignal.aborted; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(emittedBeforeCancellation.includes(image.data), false);
    await reader.cancel().catch(() => {});
  });
});
