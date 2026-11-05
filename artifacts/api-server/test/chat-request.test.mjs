import test from "node:test";
import assert from "node:assert/strict";
import { buildChatRequest, isValidTimeZone, boundedHistory } from "../src/lib/chat-request.ts";
import { extractSearchSources } from "../src/lib/search-activity.ts";
import { needsWebSearch, isCodingRequest, buildSearchQuery } from "../src/lib/chat-policy.ts";
import { chooseModels, openModelStream, USAGE_LIMIT_MESSAGE, PRIMARY_MODEL, SMALL_MODEL, CODING_FALLBACK, markRateLimited, isCoolingDown, rateLimitDiagnostics } from "../src/lib/model-routing.ts";

const messages = [{ role: "user", content: "What is 17 times 19?" }];

test("normal chat always uses Groq GPT-OSS 120B with medium effort", () => {
  const result = buildChatRequest({ messages });
  assert.equal(result.model, "openai/gpt-oss-120b");
  assert.equal(result.reasoning_effort, "medium");
  assert.equal(result.include_reasoning, true);
  assert.equal(result.stream, true);
  assert.deepEqual(result.messages.at(-1), messages[0]);
});

test("Deepthink raises effort to high without changing provider or model", () => {
  const result = buildChatRequest({ messages, deepthink: true });
  assert.equal(result.reasoning_effort, "high");
  assert.equal(result.model, "openai/gpt-oss-120b");
  assert.equal(result.include_reasoning, true);
  assert.ok(result.max_completion_tokens >= 8192);
});

test("explicitly disabling Deepthink restores medium effort", () => {
  assert.equal(buildChatRequest({ messages, deepthink: false }).reasoning_effort, "medium");
});

test("caller model and effort overrides are ignored and history is unmodified", () => {
  const original = structuredClone(messages);
  const result = buildChatRequest({ messages, model: "other", reasoning_effort: "low" });
  assert.equal(result.model, "openai/gpt-oss-120b");
  assert.equal(result.reasoning_effort, "medium");
  assert.deepEqual(messages, original);
});

test("Groq browser tools stay disabled while provider-exposed reasoning is requested", () => {
  const result = buildChatRequest({ messages });
  assert.equal(result.tools, undefined);
  assert.equal(result.tool_choice, "none");
  assert.equal(result.include_reasoning, true);
});

test("coding instructions require imports and describe packages as on demand", () => {
  const request = buildChatRequest({ messages }, new Date(), { coding: true });
  assert.match(request.messages[0].content, /available on demand when imported/);
  assert.match(request.messages[0].content, /aliases are not preloaded/);
  assert.match(request.messages[0].content, /Import every library you use explicitly/);
});

test("fresh UTC and local clock context comes from the server, not model memory", () => {
  const now = new Date("2026-11-02T18:30:00Z");
  const result = buildChatRequest({ messages, timeZone: "America/Chicago" }, now);
  assert.match(result.messages[0].content, /2026-11-02T18:30:00.000Z/);
  assert.match(result.messages[0].content, /America\/Chicago/);
  assert.match(result.messages[0].content, /12:30:00 PM/);
  assert.equal(isValidTimeZone("America/Chicago"), true);
  assert.equal(isValidTimeZone("not/a/timezone"), false);
});

test("failed web retrieval is disclosed and cannot be represented as verified current facts", () => {
  const result = buildChatRequest({ messages }, new Date("2026-11-04T12:00:00Z"), { searchFailed: true });
  assert.match(result.messages[0].content, /External web search failed for this request/);
  assert.match(result.messages[0].content, /Tell the user you could not verify the current information/);
  assert.match(result.messages[0].content, /Do not invent recent facts or sources/);
});

test("public sources are deduplicated and unsafe links rejected", () => {
  assert.deepEqual(extractSearchSources([{
    type: "browser_search",
    browser_results: [
      { url: "https://www.nasa.gov/news/", title: "NASA News" },
      { url: "javascript:alert(1)", title: "bad" },
      { url: "https://password:secret@example.com/", title: "bad" },
    ],
    search_results: { results: [{ url: "https://www.nasa.gov/news/", title: "NASA News" }] },
  }]), [{ url: "https://www.nasa.gov/news/", title: "NASA News" }]);
});

test("search is selective, honors the 2024 policy and does not waste searches on clock or coding", () => {
  for (const prompt of ["Hi", "Explain Newton's laws", "Explain binary search", "Implement binary search in Python", "What happened in 1999?", "Search the web about the 1969 moon landing", "What is the current date and time?", "Write Python code to sort a list", "My current code has a bug"]) {
    assert.equal(needsWebSearch(prompt), false, prompt);
  }
  for (const prompt of ["What happened at the 2024 Olympics?", "Latest NASA news", "Who is the president of the USA?", "What is today's weather in Chicago?", "Latest Python version", "What is the current Python version?", "Newest NumPy release", "Search the web for Python numpy examples", "Look up JavaScript promises online", "Check online whether this Python library is maintained", "What is happening in Chicago right now?"]) {
    assert.equal(needsWebSearch(prompt), true, prompt);
  }
  assert.equal(isCodingRequest("Generate Python code using numpy"), true);
  assert.equal(isCodingRequest("Tell me a story"), false);
  assert.match(buildSearchQuery([{role:"user",content:"Weather in Chicago"}, {role:"assistant",content:"Sunny"}, {role:"user",content:"What about tomorrow?"}]), /Weather in Chicago/);
});

test("model selection uses a real coder when available and the requested fallbacks otherwise", () => {
  const ids = [PRIMARY_MODEL, SMALL_MODEL, CODING_FALLBACK];
  assert.deepEqual(chooseModels(ids, false), [PRIMARY_MODEL, SMALL_MODEL]);
  assert.deepEqual(chooseModels(ids, true), [PRIMARY_MODEL, CODING_FALLBACK]);
  assert.deepEqual(chooseModels([...ids,"qwen/example-coder"], true), ["qwen/example-coder", CODING_FALLBACK]);
});

test("an actual 429 switches models once and emits a downgrade notice", async () => {
  const attempts = [], notices = [];
  const result = await openModelStream(["unit-primary","unit-fallback"], async model => {
    attempts.push(model);
    if (model === "unit-primary") throw {status:429};
    return "working-stream";
  }, model => notices.push(model));
  assert.deepEqual(attempts, ["unit-primary","unit-fallback"]);
  assert.deepEqual(notices, ["unit-fallback"]);
  assert.equal(result.model, "unit-fallback");
  assert.equal(result.stream, "working-stream");
});

test("exhausting both models returns the exact requested usage message", async () => {
  await assert.rejects(openModelStream(["quota-a","quota-b"], async () => {throw {status:429};}, () => {}), {message:USAGE_LIMIT_MESSAGE});
  assert.equal(USAGE_LIMIT_MESSAGE, "You have reached your usage limits, please try again later");
});

test("authorization errors are not incorrectly treated as usage limits", async () => {
  let attempts = 0;
  await assert.rejects(openModelStream(["auth-a","auth-b"], async () => {attempts++;throw Object.assign(new Error("Denied"),{status:401});}, () => {}));
  assert.equal(attempts, 1);
});

test("cooldowns honor short retry-after values without an artificial minimum", () => {
  const original = Date.now;
  let clock = 100000;
  Date.now = () => clock;
  try {
    markRateLimited("short-window", "0.5");
    assert.equal(isCoolingDown("short-window"), true);
    clock += 501;
    assert.equal(isCoolingDown("short-window"), false);
    markRateLimited("missing-window");
    clock += 1001;
    assert.equal(isCoolingDown("missing-window"), false);
    markRateLimited("date-window", new Date(clock + 3000).toUTCString());
    clock += 3001;
    assert.equal(isCoolingDown("date-window"), false);
    markRateLimited("daily-token-window", "1147");
    clock += 301000;
    assert.equal(isCoolingDown("daily-token-window"), true);
    clock += 847000;
    assert.equal(isCoolingDown("daily-token-window"), false);
  } finally { Date.now = original; }
});

test("quota diagnostics identify token limits without copying provider bodies", async () => {
  const error = {status:429, headers:new Headers({"retry-after":"0.5","x-ratelimit-remaining-requests":"990"}),
    error:{error:{message:"Rate limit on tokens per minute (TPM). PRIVATE PROMPT"}}};
  const attempts = [];
  await openModelStream(["diagnostic-a","diagnostic-b"], async model => {
    if(model === "diagnostic-a") throw error;
    return "ok";
  }, () => {}, (model, quota) => attempts.push({model,...quota}));
  assert.equal(attempts[0].metric, "TPM");
  assert.equal(attempts[0].remainingRequests, "990");
  assert.equal(JSON.stringify(rateLimitDiagnostics(error)).includes("PRIVATE"), false);
});

test("a failed fallback never claims a lighter model is answering", async () => {
  const notices = [];
  await assert.rejects(openModelStream(["failed-notice-a", "failed-notice-b"],
    async () => { throw {status:429}; }, model => notices.push(model)), {message:USAGE_LIMIT_MESSAGE});
  assert.deepEqual(notices, []);
});

test("a successful fallback is announced only after its stream is accepted", async () => {
  const events = [];
  await openModelStream(["ordered-a", "ordered-b"], async model => {
    events.push(`attempt:${model}`);
    if (model === "ordered-a") throw {status:429};
    events.push("accepted");
    return "stream";
  }, model => events.push(`notice:${model}`));
  assert.deepEqual(events, ["attempt:ordered-a","attempt:ordered-b","accepted","notice:ordered-b"]);
});

test("Qwen coding fallback returns reasoning separately using its supported parsed format", () => {
  const result = buildChatRequest({messages,deepthink:true},new Date(),{model:CODING_FALLBACK,coding:true});
  assert.equal(result.model,CODING_FALLBACK);
  assert.equal(result.reasoning_format,"parsed");
  assert.equal(result.include_reasoning,undefined);
  assert.equal(result.tools,undefined);
  assert.match(result.messages[0].content,/NumPy/);
});

test("only API context is bounded; the newest message is retained and input history unmodified", () => {
  const history = Array.from({length:20},(_,i)=>({role:i%2?"user":"assistant",content:String(i).repeat(2000)}));
  const original = structuredClone(history);
  const bounded = boundedHistory(history,16000);
  assert.ok(bounded.reduce((n,m)=>n+m.content.length,0)<=16000);
  assert.deepEqual(bounded.at(-1),history.at(-1));
  assert.deepEqual(history,original);
});
