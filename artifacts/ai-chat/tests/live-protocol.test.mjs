import test from "node:test";
import assert from "node:assert/strict";
import { createLiveMessageQueue, liveConnectionError, liveProviderError } from "../src/lib/live-protocol.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("Live decoder preserves ordering across delayed Blob, ArrayBuffer and string messages", async () => {
  const received = [];
  let decode;
  const blob = new Blob();
  blob.text = () => new Promise((resolve) => { decode = resolve; });
  const queue = createLiveMessageQueue((message) => received.push(message.index), () => assert.fail("Unexpected protocol error"));
  queue.push(blob);
  queue.push(new TextEncoder().encode('{"index":2}').buffer);
  queue.push('{"index":3}');
  assert.deepEqual(received, []);
  decode('{"index":1}');
  await tick();
  assert.deepEqual(received, [1, 2, 3]);
  queue.close();
});

test("closing the decoder discards pending Blob conversions and queued messages", async () => {
  let decode;
  const blob = new Blob();
  blob.text = () => new Promise((resolve) => { decode = resolve; });
  const queue = createLiveMessageQueue(() => assert.fail("Stale message delivered"), () => assert.fail("Stale error delivered"));
  queue.push(blob);
  queue.push('{"index":2}');
  queue.close();
  decode('{"index":1}');
  await tick();
});

test("malformed, unsupported, oversized and overflowing messages fail once and close the queue", async () => {
  for (const invalid of ['{', '[]', 'null', 42, new ArrayBuffer(1_048_577), new Uint8Array([255]).buffer]) {
    let errors = 0;
    const queue = createLiveMessageQueue(() => assert.fail("Invalid message delivered"), () => { errors++; });
    queue.push(invalid);
    queue.push('{"ignored":true}');
    await tick();
    assert.equal(errors, 1);
  }
  let errors = 0;
  let decode;
  const blob = new Blob();
  blob.text = () => new Promise((resolve) => { decode = resolve; });
  const queue = createLiveMessageQueue(() => assert.fail("Overflowing queue delivered"), () => { errors++; });
  queue.push(blob);
  for (let index = 0; index < 66; index++) queue.push('{}');
  decode('{}');
  await tick();
  assert.equal(errors, 1);
});

test("Live errors distinguish access, quota and configuration without exposing provider text", () => {
  assert.match(liveProviderError(403), /denied Live access/);
  assert.match(liveProviderError("RESOURCE_EXHAUSTED"), /rate-limited/);
  assert.match(liveProviderError(404), /configuration/);
  assert.match(liveConnectionError(1008, false), /permissions/);
  assert.match(liveConnectionError(1011, true), /temporarily/);
  assert.match(liveConnectionError(1006, false), /could not connect/);
});
