import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_INPUT_FRAMES_PER_CHUNK,
  LIVE_INPUT_SAMPLE_RATE,
  LIVE_OUTPUT_SAMPLE_RATE,
  decodePcm16LeBase64,
  encodePcm16LeBase64,
  resampleMonoToLiveInput,
  createLiveInputResampler,
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

test("streaming resampling has no cumulative drift at native 44.1 and 48 kHz", () => {
  for (const rate of [44_100, 48_000, 16_000]) {
    const total = rate * 3;
    const input = Float32Array.from({ length: total }, (_, index) => Math.sin(index / 30));
    const resampler = createLiveInputResampler(rate);
    const actual = [];
    for (let start = 0; start < total; start += 128) actual.push(...resampler.process(input.subarray(start, start + 128)));
    assert.ok(Math.abs(actual.length - 48_000) <= 1, `${rate}: ${actual.length}`);
    const expected = resampleMonoToLiveInput(input, rate);
    for (let index = 0; index < actual.length; index++) assert.ok(Math.abs(actual[index] - expected[index]) < 0.00001);
    resampler.reset();
    assert.deepEqual([...resampler.process(input.subarray(0, 128))], [...createLiveInputResampler(rate).process(input.subarray(0, 128))]);
  }
});

test("PCM rejects malformed/oversized data and encodes non-finite samples as silence", () => {
  for (const invalid of ["", "!", "AA==", "A".repeat(1_048_577)]) assert.throws(() => decodePcm16LeBase64(invalid));
  assert.deepEqual([...decodePcm16LeBase64(encodePcm16LeBase64([NaN, Infinity, -Infinity]))], [0, 0, 0]);
  assert.throws(() => createLiveInputResampler(0));
  assert.throws(() => createLiveInputResampler(48_000).process(new Float32Array(192_001)));
});
