import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_LIVE_TOOLS, liveSystemInstruction } from "../src/lib/live-tools.ts";

test("Live exposes only the workspace actions the app can complete", () => {
  const functions = GEMINI_LIVE_TOOLS.flatMap((tool) => tool.functionDeclarations);
  assert.deepEqual(functions.map((item) => item.name), ["open_workspace", "start_agent"]);
  assert.deepEqual(functions[1].parameters.required, ["task"]);
  assert.match(functions[0].description, /do not start a build/);
  assert.match(functions[1].description, /keep this Live voice session open/);
});

test("Live instructions wait for an actual Agent completion update", () => {
  for (const deepthink of [false, true]) {
    const instructions = liveSystemInstruction(deepthink);
    assert.match(instructions, /do not claim it is finished until the app sends a completion update/);
    assert.match(instructions, /continue the conversation/);
  }
  assert.match(liveSystemInstruction(true), /high background reasoning/);
});
