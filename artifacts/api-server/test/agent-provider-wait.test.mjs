import test from "node:test";
import assert from "node:assert/strict";
import { agentProviderRetryDelay } from "../src/lib/agent-provider-wait.ts";

const quota = { requestTooLarge: false, metric: "OTPM", retryAfter: "11" };

test("Agent allows three explicit Qwen retry windows, but not an unlimited loop", () => {
  const state = { count: 0, totalMs: 0 };
  for (let index = 0; index < 3; index++) {
    const delay = agentProviderRetryDelay(quota, state, 170_000);
    assert.equal(delay, 11250);
    state.count++;
    state.totalMs += delay;
  }
  assert.equal(agentProviderRetryDelay(quota, state, 170_000), undefined);
});

test("Agent waiting fits both its aggregate budget and the hosting deadline", () => {
  const empty = { count: 0, totalMs: 0 };
  assert.equal(agentProviderRetryDelay(quota, { count: 1, totalMs: 80_000 }, 170_000), undefined);
  assert.equal(agentProviderRetryDelay(quota, { count: 1, totalMs: 78_750 }, 170_000), 11250);
  assert.equal(agentProviderRetryDelay(quota, empty, 31_250), 11250);
  assert.equal(agentProviderRetryDelay(quota, empty, 31_249), undefined);
});

test("Agent never waits on oversized requests, daily quotas or unspecified windows", () => {
  for (const overrides of [
    { requestTooLarge: true }, { metric: "TPD" }, { metric: "RPD" },
    { retryAfter: null }, { retryAfter: "invalid" }, { retryAfter: "3600" },
  ]) {
    assert.equal(agentProviderRetryDelay({ ...quota, ...overrides }, { count: 0, totalMs: 0 }, 170_000), undefined);
  }
});
