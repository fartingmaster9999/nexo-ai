import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_LIVE_TOOLS, liveSystemInstruction } from "../src/lib/live-tools.ts";

test("Live Agent tool stages only direct build requests for user confirmation", () => {
  const startAgent = GEMINI_LIVE_TOOLS[0].functionDeclarations.find((tool) => tool.name === "start_agent");
  assert.ok(startAgent);
  assert.match(startAgent.description, /Stage a build request for user confirmation/);
  assert.match(startAgent.description, /This does not start Agent/);
  assert.match(startAgent.description, /Never call for casual conversation, hypotheticals/);

  const instruction = liveSystemInstruction(false);
  assert.match(instruction, /Only call start_agent after the user directly asks/);
  assert.match(instruction, /The app shows the captured task and asks the user to confirm/);
  assert.match(instruction, /do not claim Agent has started unless the app later reports that it started/);
});
