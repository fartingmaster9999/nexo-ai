import test from "node:test";
import assert from "node:assert/strict";
import { createProgramReviewMemo } from "../src/lib/program-review-memo.ts";

test("only identical source, run evidence, prompt, and image reuse a successful review", () => {
  const memo = createProgramReviewMemo();
  const input = { messages: ["Build a counter"], agentReview: { source: "counter", output: "1", browserChecks: "pass" } };
  assert.equal(memo.read(input), undefined);
  memo.remember(input, "Missing reset handler.");
  assert.equal(memo.read(structuredClone(input)), "Missing reset handler.");
  for (const changed of [
    { ...input, messages: ["Build a timer"] },
    { ...input, image: { data: "new-image" } },
    { ...input, agentReview: { ...input.agentReview, source: "counter with reset" } },
    { ...input, agentReview: { ...input.agentReview, output: "runtime failure" } },
    { ...input, agentReview: { ...input.agentReview, browserChecks: "fail" } },
  ]) assert.equal(memo.read(changed), undefined);
  assert.equal(createProgramReviewMemo().read(input), undefined, "no cross-run/user cache");
});

test("empty reviews are never remembered and only the latest successful input is retained", () => {
  const memo = createProgramReviewMemo();
  memo.remember("one", " ");
  assert.equal(memo.read("one"), undefined);
  memo.remember("one", "Check one");
  memo.remember("two", "Check two");
  assert.equal(memo.read("one"), undefined);
  assert.equal(memo.read("two"), "Check two");
});
