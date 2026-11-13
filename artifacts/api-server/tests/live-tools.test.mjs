import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_LIVE_TOOLS, liveSystemInstruction } from "../src/lib/live-tools.ts";

test("Live exposes mode, workspace, web, and Agent actions as non-blocking tools", () => {
  const functions = GEMINI_LIVE_TOOLS.flatMap((tool) => tool.functionDeclarations);
  assert.deepEqual(functions.map((item) => item.name), [
    "open_workspace", "open_external_link", "set_deepthink", "set_agent_mode", "get_nexo_modes", "start_agent",
  ]);
  assert.ok(functions.every((item) => item.behavior === "NON_BLOCKING"));
  assert.deepEqual(functions[5].parameters.required, ["task"]);
  assert.match(functions[0].description, /do not start a build/);
  assert.match(functions[1].description, /Google Classroom course/);
  assert.match(functions[2].description, /app reconnects and restores/);
  assert.match(functions[5].description, /keep this Live voice session open/);
});

test("Live instructions wait for an actual Agent completion update", () => {
  for (const deepthink of [false, true]) {
    const instructions = liveSystemInstruction(deepthink);
    assert.match(instructions, /do not claim it is finished until the app sends a completion update/);
    assert.match(instructions, /continue the conversation/);
    assert.match(instructions, /call open_external_link/);
    assert.match(instructions, /call set_deepthink or set_agent_mode/);
  }
  assert.match(liveSystemInstruction(true), /high background reasoning/);
});
