import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveAgentPrompt,
  buildLiveResumeContext,
  readLiveFunctionCalls,
} from "../src/lib/live-agent-handoff.ts";

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

test("restores recent Live context without carrying interim text or an unbounded history", () => {
  const context = buildLiveResumeContext([
    { role: "user", text: "Please remember this project is a study planner." },
    { role: "assistant", text: "I will keep that in mind." },
    { role: "user", text: "This is still being spoken", interim: true },
  ]);
  assert.match(context, /Internal context from the previous part/);
  assert.match(context, /User: Please remember this project is a study planner\./);
  assert.match(context, /Nexo: I will keep that in mind\./);
  assert.doesNotMatch(context, /still being spoken/);
  assert.ok(buildLiveResumeContext([{ role: "user", text: "x".repeat(20_000) }]).length < 6_200);
});
