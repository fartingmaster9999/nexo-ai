type CaptureOptions = {
  context: AudioContext;
  stream: MediaStream;
  signal: AbortSignal;
  onSamples: (samples: Float32Array) => void;
  onError: () => void;
};

// Batch render quanta inside the worklet rather than posting 125–375 messages/sec.
const PROCESSOR_SOURCE = `
  class NexoLiveInput extends AudioWorkletProcessor {
    constructor() { super(); this.samples = new Float32Array(1024); this.offset = 0; }
    process(inputs) {
      const channel = inputs[0] && inputs[0][0];
      if (channel) for (let start = 0; start < channel.length;) {
        const count = Math.min(channel.length - start, this.samples.length - this.offset);
        this.samples.set(channel.subarray(start, start + count), this.offset);
        this.offset += count;
        start += count;
        if (this.offset === this.samples.length) {
          this.port.postMessage(this.samples, [this.samples.buffer]);
          this.samples = new Float32Array(1024);
          this.offset = 0;
        }
      }
      return true;
    }
  }
  registerProcessor("nexo-live-input", NexoLiveInput);
`;

/** Own the entire capture graph, including pending worklet setup and event handlers. */
export async function startLiveCapture({ context, stream, signal, onSamples, onError }: CaptureOptions): Promise<void> {
  if (signal.aborted) return;
  const nodes: AudioNode[] = [];
  let moduleUrl: string | undefined;
  let processor: ScriptProcessorNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let cleaned = false;
  const tracks = stream.getAudioTracks();
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    signal.removeEventListener("abort", cleanup);
    tracks.forEach((track) => track.removeEventListener("ended", onError));
    if (moduleUrl) URL.revokeObjectURL(moduleUrl);
    if (processor) processor.onaudioprocess = null;
    if (worklet) {
      worklet.port.onmessage = null;
      worklet.onprocessorerror = null;
      worklet.port.close();
    }
    nodes.forEach((node) => { try { node.disconnect(); } catch { /* already disconnected */ } });
  };
  signal.addEventListener("abort", cleanup, { once: true });
  tracks.forEach((track) => track.addEventListener("ended", onError));
  try {
    const source = context.createMediaStreamSource(stream);
    nodes.push(source);
    const silence = context.createGain();
    silence.gain.value = 0;
    nodes.push(silence);
    if (context.audioWorklet) {
      moduleUrl = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(moduleUrl);
        if (signal.aborted) return;
        worklet = new AudioWorkletNode(context, "nexo-live-input");
        nodes.push(worklet);
        worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
          if (!signal.aborted) onSamples(event.data);
        };
        worklet.onprocessorerror = onError;
        source.connect(worklet);
        worklet.connect(silence);
      } catch {
        if (signal.aborted) return;
        // Old Safari / devices without usable AudioWorklet support.
        if (worklet) throw new Error("Live worklet could not connect");
      } finally {
        if (moduleUrl) URL.revokeObjectURL(moduleUrl);
        moduleUrl = undefined;
      }
    }
    if (!worklet) {
      processor = context.createScriptProcessor(4096, 1, 1);
      nodes.push(processor);
      processor.onaudioprocess = (event) => {
        if (!signal.aborted) onSamples(event.inputBuffer.getChannelData(0));
      };
      source.connect(processor);
      processor.connect(silence);
    }
    silence.connect(context.destination);
  } catch (error) {
    cleanup();
    throw error;
  }
}
