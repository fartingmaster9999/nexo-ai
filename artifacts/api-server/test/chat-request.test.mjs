import test from "node:test";
import assert from "node:assert/strict";
import { buildChatRequest } from "../src/lib/chat-request.ts";

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
