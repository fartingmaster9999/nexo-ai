export const LIVE_INPUT_SAMPLE_RATE = 16_000;
export const LIVE_OUTPUT_SAMPLE_RATE = 24_000;
export const LIVE_INPUT_FRAMES_PER_CHUNK = 1_600;

export function resampleMonoToLiveInput(input: Float32Array, inputSampleRate: number): Float32Array {
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new RangeError("The input audio sample rate must be positive.");
  }
  if (inputSampleRate === LIVE_INPUT_SAMPLE_RATE) return input.slice();
  if (input.length === 0) return new Float32Array();

  const outputLength = Math.max(1, Math.ceil(input.length * LIVE_INPUT_SAMPLE_RATE / inputSampleRate));
  const output = new Float32Array(outputLength);
  const ratio = inputSampleRate / LIVE_INPUT_SAMPLE_RATE;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(Math.floor(position), input.length - 1);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[index] = input[left] + (input[right] - input[left]) * fraction;
  }
  return output;
}

export function encodePcm16LeBase64(samples: ArrayLike<number>): string {
  let bytes = "";
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    const value = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    const pcm = value & 0xffff;
    bytes += String.fromCharCode(pcm & 0xff, (pcm >> 8) & 0xff);
  }
  return btoa(bytes);
}

export function decodePcm16LeBase64(base64: string): Int16Array {
  const binary = atob(base64);
  const samples = new Int16Array(Math.floor(binary.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    const value = low | (high << 8);
    samples[index] = value & 0x8000 ? value - 0x10000 : value;
  }
  return samples;
}
