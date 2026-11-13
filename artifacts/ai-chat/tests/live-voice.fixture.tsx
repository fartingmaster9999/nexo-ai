import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveVoiceDialog } from "../src/components/live-voice-dialog";
import { buildLiveAgentPrompt } from "../src/lib/live-agent-handoff";
import type {
  LiveAgentRunState,
  LiveExternalLinkResult,
  LiveModeUpdateResult,
  LiveTranscriptLine,
} from "../src/lib/live-agent-handoff";

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
  __liveSockets?: MockSocket[];
  __liveUrl?: string;
  __liveMessages?: unknown[];
  __liveTrack?: { enabled: boolean; stopped: boolean; stop(): void };
  __settingsOpened?: boolean;
  __workspaceClicks?: number;
  __liveContexts?: MockAudioContext[];
  __liveSources?: ReturnType<MockAudioContext["createBufferSource"]>[];
  __liveProcessor?: { onaudioprocess: ((event: { inputBuffer: { getChannelData(): Float32Array } }) => void) | null };
  __denyMic?: boolean;
  __holdMic?: boolean;
  __resolveMic?: () => void;
  __holdPlayback?: boolean;
  __tokenFailure?: boolean;
  __agentHandoff?: unknown[];
  __agentPrompt?: string;
  __finishAgentRun?: () => void;
  __deepthinkEnabled?: boolean;
  __agentModeEnabled?: boolean;
  __externalTarget?: string;
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
    (testWindow.__liveSockets ??= []).push(this);
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
    const toolResponses = message && typeof message === "object" && "toolResponse" in message
      ? (message as { toolResponse?: { functionResponses?: Array<{ name?: string }> } }).toolResponse?.functionResponses
      : undefined;
    if (toolResponses?.length) {
      window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ serverContent: {
        outputTranscription: { text: "I’ve taken care of that." },
        turnComplete: true,
        interactionStatus: "IDLE",
      } }) }), 0);
    }
    const contextText = message && typeof message === "object" && "clientContent" in message
      ? JSON.stringify((message as { clientContent?: unknown }).clientContent)
      : "";
    if (contextText.includes("Internal context from the previous part of this same Live conversation")) {
      window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ serverContent: {
        outputTranscription: { text: "I’m back with our conversation." },
        turnComplete: true,
        interactionStatus: "IDLE",
      } }) }), 0);
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
  const [deepthink, setDeepthink] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [agentWork, setAgentWork] = useState<LiveAgentRunState | null>(null);
  return (<>
    <button type="button" id="reopen-live" onClick={() => setOpen(true)}>Reopen Live</button>
    <button type="button" id="workspace-control" onClick={() => { testWindow.__workspaceClicks = (testWindow.__workspaceClicks ?? 0) + 1; }}>Workspace control</button>
    <LiveVoiceDialog
      open={open}
      onOpenChange={setOpen}
      fetchToken={async () => {
        if (testWindow.__tokenFailure) throw Object.assign(new Error("Add a Gemini API key in Settings to use Nexo Live."), { openProviderSettings: true });
        testWindow.__deepthinkEnabled = deepthink;
        return {
          token: "test-ephemeral-token",
          model: deepthink ? "gemini-3.8-live-extended-thinking" : "gemini-3.8-live",
        };
      }}
      deepthink={deepthink}
      agentMode={agentMode}
      workspaceOpen={workspaceOpen}
      agentWork={agentWork}
      onOpenSettings={() => { (window as TestWindow).__settingsOpened = true; }}
      onOpenWorkspace={() => {
        if (workspaceOpen) {
          testWindow.__workspaceClicks = (testWindow.__workspaceClicks ?? 0) + 1;
          return { opened: true };
        }
        return { opened: false, reason: "No saved workspace yet." };
      }}
      onSetDeepthink={(enabled): LiveModeUpdateResult => {
        const changed = deepthink !== enabled;
        setDeepthink(enabled);
        testWindow.__deepthinkEnabled = enabled;
        return { enabled, changed };
      }}
      onSetAgentMode={(enabled): LiveModeUpdateResult => {
        const changed = agentMode !== enabled;
        setAgentMode(enabled);
        testWindow.__agentModeEnabled = enabled;
        return { enabled, changed };
      }}
      onOpenExternalLink={(target): LiveExternalLinkResult => {
        testWindow.__externalTarget = target;
        const url = /^https?:\/\//i.test(target) ? target : `https://${target}`;
        return { opened: false, label: target || "requested website", url, reason: "popup_blocked" };
      }}
      onBuildWithAgent={(transcript: LiveTranscriptLine[], task) => {
        testWindow.__agentHandoff = transcript;
        testWindow.__agentPrompt = buildLiveAgentPrompt(transcript);
        setWorkspaceOpen(true);
        const run: LiveAgentRunState = { id: "fixture-agent-run", status: "running", task: task ?? "Build request" };
        setAgentWork(run);
        testWindow.__finishAgentRun = () => setAgentWork({ ...run, status: "finished" });
        return { accepted: true };
      }}
    />
  </>);
}

createRoot(document.getElementById("root")!).render(<Fixture />);
