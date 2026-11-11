import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveVoiceDialog } from "../src/components/live-voice-dialog";

type MockSocket = {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  send(payload: string): void;
  close(): void;
};

type TestWindow = Window & {
  __liveSocket?: MockSocket;
  __liveUrl?: string;
  __liveMessages?: unknown[];
  __liveTrack?: { enabled: boolean; stopped: boolean; stop(): void };
  __settingsOpened?: boolean;
  __liveContexts?: MockAudioContext[];
  __liveSources?: ReturnType<MockAudioContext["createBufferSource"]>[];
  __liveProcessor?: { onaudioprocess: ((event: { inputBuffer: { getChannelData(): Float32Array } }) => void) | null };
  __denyMic?: boolean;
  __holdMic?: boolean;
  __resolveMic?: () => void;
  __holdPlayback?: boolean;
  __tokenFailure?: boolean;
};

const testWindow = window as TestWindow;

class MockWebSocket {
  static OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  bufferedAmount = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    testWindow.__liveUrl = String(url);
    testWindow.__liveSocket = this;
    window.setTimeout(() => {
      if (this.readyState === 3) return;
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    }, 0);
  }

  send(payload: string) {
    const message: unknown = JSON.parse(payload);
    testWindow.__liveMessages ??= [];
    testWindow.__liveMessages.push(message);
    if (typeof message === "object" && message !== null && "setup" in message) {
      window.setTimeout(() => this.onmessage?.({ data: new Blob([JSON.stringify({ setupComplete: {} })]) }), 0);
    }
  }

  close() {
    this.readyState = 3;
    this.onclose?.(new Event("close"));
  }
}

class MockAudioContext {
  sampleRate: number;
  currentTime = 0;
  state = "suspended";
  destination = {};

  constructor() {
    this.sampleRate = 48_000;
    (testWindow.__liveContexts ??= []).push(this);
  }

  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
  createMediaStreamSource() { return mockNode(); }
  createGain() { return { ...mockNode(), gain: { value: 1 } }; }
  createScriptProcessor() {
    const processor = { ...mockNode(), onaudioprocess: null };
    testWindow.__liveProcessor = processor;
    return processor;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const source = {
      ...mockNode(),
      buffer: null as unknown,
      stopped: false,
      onended: null as (() => void) | null,
      start: () => { if (!testWindow.__holdPlayback) window.setTimeout(() => source.onended?.(), 5); },
      stop: () => { source.stopped = true; source.onended?.(); },
    };
    (testWindow.__liveSources ??= []).push(source);
    return source;
  }
}

function mockNode() {
  return { disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
}

Object.defineProperty(window, "WebSocket", { configurable: true, value: MockWebSocket });
Object.defineProperty(window, "AudioContext", { configurable: true, value: MockAudioContext });
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    getUserMedia: async () => {
      if (testWindow.__denyMic) throw new DOMException("Test denial", "NotAllowedError");
      if (testWindow.__holdMic) await new Promise<void>((resolve) => { testWindow.__resolveMic = resolve; });
      const track = Object.assign(new EventTarget(), {
        enabled: true, stopped: false, stop() { this.stopped = true; },
      });
      testWindow.__liveTrack = track;
      return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    },
  },
});

function Fixture() {
  const [open, setOpen] = useState(true);
  return (<>
    <button type="button" id="reopen-live" onClick={() => setOpen(true)}>Reopen Live</button>
    <LiveVoiceDialog
      open={open}
      onOpenChange={setOpen}
      fetchToken={async () => {
        if (testWindow.__tokenFailure) throw Object.assign(new Error("Add a Gemini API key in Settings to use Nexo Live."), { openProviderSettings: true });
        return { token: "test-ephemeral-token", model: "gemini-3.8-live" };
      }}
      onOpenSettings={() => { (window as TestWindow).__settingsOpened = true; }}
    />
  </>);
}

createRoot(document.getElementById("root")!).render(<Fixture />);
