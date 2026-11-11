import test from "node:test";
import assert from "node:assert/strict";
import { withFeedbackBudget, FeedbackTimeoutError } from "../src/lib/feedback-budget.ts";

test("feedback hard deadline releases even an adapter ignoring abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let upstreamSignal;
  const result = withFeedbackBudget(async signal => {
    upstreamSignal = signal;
    return new Promise(() => {});
  }, new AbortController().signal, 20);
  await Promise.resolve();
  const rejection = assert.rejects(result, FeedbackTimeoutError);
  t.mock.timers.tick(20);
  await rejection;
  assert.equal(upstreamSignal.aborted, true);
});

test("feedback cancellation preserves caller reason and never becomes a timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const parent = new AbortController();
  let upstreamSignal;
  const result = withFeedbackBudget(async signal => {
    upstreamSignal = signal;
    return new Promise(() => {});
  }, parent.signal, 100);
  await Promise.resolve();
  const reason = new Error("user stopped");
  parent.abort(reason);
  await assert.rejects(result, error => error === reason);
  assert.equal(upstreamSignal.reason, reason);
  t.mock.timers.tick(1000);
});

test("successful feedback cleans up the deadline and never aborts its caller", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const parent = new AbortController();
  const value = await withFeedbackBudget(async () => "Actionable finding", parent.signal, 20);
  assert.equal(value, "Actionable finding");
  t.mock.timers.tick(100);
  assert.equal(parent.signal.aborted, false);
});

test("already-cancelled feedback never starts provider work", async () => {
  const parent = new AbortController();
  parent.abort();
  let started = false;
  await assert.rejects(withFeedbackBudget(async () => { started = true; }, parent.signal, 1));
  assert.equal(started, false);
});
