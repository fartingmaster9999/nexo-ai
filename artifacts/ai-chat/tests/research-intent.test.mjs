import assert from "node:assert/strict";
import test from "node:test";
import { isResearchOnlyRequest } from "../src/lib/research-intent.ts";

test("research-only prompts use the research view", () => {
  for (const prompt of [
    "Research recent changes to the FAFSA",
    "Nexo, investigate how sleep affects memory",
    "Look into the latest accessibility guidance",
    "Gather sources about coral bleaching",
  ]) {
    assert.equal(isResearchOnlyRequest(prompt), true, prompt);
  }
});

test("research combined with a build stays in Agent", () => {
  assert.equal(isResearchOnlyRequest("Research the topic, then build me a study website"), false);
  assert.equal(isResearchOnlyRequest("Research the APIs and create a dashboard"), false);
});

test("how-to research does not become a coding build", () => {
  assert.equal(isResearchOnlyRequest("Research how to build a simple website"), true);
  assert.equal(isResearchOnlyRequest("How do I research this topic?"), true);
});
