import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_INPUT_FRAMES_PER_CHUNK,
  LIVE_INPUT_SAMPLE_RATE,
  LIVE_OUTPUT_SAMPLE_RATE,
  decodePcm16LeBase64,
  encodePcm16LeBase64,
  resampleMonoToLiveInput,
} from "../src/lib/live-audio.ts";

test("Live audio uses the documented PCM sample rates and bounded input chunks", () => {
  assert.equal(LIVE_INPUT_SAMPLE_RATE, 16_000);
  assert.equal(LIVE_OUTPUT_SAMPLE_RATE, 24_000);
  assert.equal(LIVE_INPUT_FRAMES_PER_CHUNK, 1_600);
});

test("mono input is linearly resampled to 16 kHz", () => {
  const input = new Float32Array([0, 0.5, 1, 0.5]);
  const result = resampleMonoToLiveInput(input, 32_000);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result[0]) < 0.001);
  assert.ok(result[1] > 0.99);
});

test("PCM16 little-endian conversion clamps values and round-trips representative samples", () => {
  const encoded = encodePcm16LeBase64([-1, -0.5, 0, 0.5, 1, 2]);
  assert.deepEqual([...decodePcm16LeBase64(encoded)], [-32768, -16384, 0, 16384, 32767, 32767]);
});

test("invalid sample rates fail instead of silently corrupting audio", () => {
  assert.throws(() => resampleMonoToLiveInput(new Float32Array([0]), 0), /sample rate/);
});
