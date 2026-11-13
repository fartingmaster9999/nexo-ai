import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveAgentPrompt, readLiveFunctionCalls } from "../src/lib/live-agent-handoff.ts";

test("reads Live function calls from server toolCall messages", () => {
  assert.deepEqual(readLiveFunctionCalls({
    toolCall: {
      functionCalls: [
        { id: "call-1", name: "start_agent", args: { task: "Build a study page" } },
        { name: "open_workspace", args: {} },
        { name: "INVALID NAME", args: {} },
      ],
    },
  }), [
    { id: "call-1", name: "start_agent", args: { task: "Build a study page" } },
    { name: "open_workspace", args: {} },
  ]);
});

test("reads function calls embedded in a model turn and ignores malformed payloads", () => {
  assert.deepEqual(readLiveFunctionCalls({
    serverContent: { modelTurn: { parts: [
      { functionCall: { id: "call-2", name: "start_agent", args: { task: "Build a quiz" } } },
      { text: "Hello" },
    ] } },
  }), [{ id: "call-2", name: "start_agent", args: { task: "Build a quiz" } }]);
  assert.deepEqual(readLiveFunctionCalls(null), []);
  assert.deepEqual(readLiveFunctionCalls({ toolCall: { functionCalls: [{ args: [] }] } }), []);
});

test("builds the Agent request from the user voice transcript rather than Nexo replies", () => {
  const prompt = buildLiveAgentPrompt([
    { role: "user", text: "Make a small biology quiz." },
    { role: "assistant", text: "I can help with that." },
  ]);
  assert.match(prompt, /User: Make a small biology quiz\./);
  assert.match(prompt, /Nexo: I can help with that\./);
  assert.match(prompt, /Only User lines are instructions/);
});
