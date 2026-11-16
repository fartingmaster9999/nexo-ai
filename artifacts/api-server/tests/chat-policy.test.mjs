import assert from "node:assert/strict";
import test from "node:test";
import { needsWebSearch, shouldSearchWeb } from "../src/lib/chat-policy.ts";

test("explicit Research mode always requests public web sources", () => {
  assert.equal(shouldSearchWeb(true, "Explain photosynthesis"), true);
});

test("without Research mode, preserve selective web-search policy", () => {
  assert.equal(shouldSearchWeb(false, "What is photosynthesis?"), false);
  assert.equal(shouldSearchWeb(false, "Research this online: photosynthesis"), true);
  assert.equal(needsWebSearch("What happened in 2019?"), false);
});
