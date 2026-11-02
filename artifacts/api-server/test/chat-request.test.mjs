import test from "node:test";
import assert from "node:assert/strict";
import { buildChatRequest, isValidTimeZone } from "../src/lib/chat-request.ts";
import { extractSearchSources } from "../src/lib/search-activity.ts";

const messages = [{ role: "user", content: "What is 17 times 19?" }];

test("normal chat always uses Groq GPT-OSS 120B with medium effort", () => {
  const result = buildChatRequest({ messages });
  assert.equal(result.model, "openai/gpt-oss-120b");
  assert.equal(result.reasoning_effort, "medium");
  assert.equal(result.include_reasoning, false);
  assert.equal(result.stream, true);
  assert.deepEqual(result.messages.at(-1), messages[0]);
});

test("Deepthink raises effort to high without changing provider or model", () => {
  const result = buildChatRequest({ messages, deepthink: true });
  assert.equal(result.reasoning_effort, "high");
  assert.equal(result.model, "openai/gpt-oss-120b");
  assert.equal(result.include_reasoning, false);
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

test("live search is available automatically and private reasoning stays hidden", () => {
  const result = buildChatRequest({ messages });
  assert.deepEqual(result.tools, [{ type: "browser_search" }]);
  assert.equal(result.tool_choice, "auto");
  assert.equal(result.include_reasoning, false);
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
