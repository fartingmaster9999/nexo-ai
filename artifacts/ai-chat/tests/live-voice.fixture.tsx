import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveVoiceDialog } from "../src/components/live-voice-dialog";

type MockSocket = {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
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
};

const testWindow = window as TestWindow;

class MockWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    testWindow.__liveUrl = String(url);
    testWindow.__liveSocket = this;
    window.setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    }, 0);
  }

  send(payload: string) {
    const message: unknown = JSON.parse(payload);
    testWindow.__liveMessages ??= [];
    testWindow.__liveMessages.push(message);
    if (typeof message === "object" && message !== null && "setup" in message) {
      window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) }), 0);
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

  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 16_000;
  }

  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
  createMediaStreamSource() { return mockNode(); }
  createGain() { return { ...mockNode(), gain: { value: 1 } }; }
  createScriptProcessor() { return { ...mockNode(), onaudioprocess: null }; }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const source = {
      ...mockNode(),
      buffer: null as unknown,
      onended: null as (() => void) | null,
      start: () => window.setTimeout(() => source.onended?.(), 5),
      stop: () => source.onended?.(),
    };
    return source;
  }
}

function mockNode() {
  return { connect() {}, disconnect() {} };
}

Object.defineProperty(window, "WebSocket", { configurable: true, value: MockWebSocket });
Object.defineProperty(window, "AudioContext", { configurable: true, value: MockAudioContext });
const track = {
  enabled: true,
  stopped: false,
  stop() { this.stopped = true; },
};
testWindow.__liveTrack = track;
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    getUserMedia: async () => ({
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream),
  },
});

function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <LiveVoiceDialog
      open={open}
      onOpenChange={setOpen}
      fetchToken={async () => ({ token: "test-ephemeral-token", model: "gemini-3.8-live" })}
      onOpenSettings={() => { (window as TestWindow).__settingsOpened = true; }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
