import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Bot, Brain, ExternalLink, Loader2, Mic, MicOff, PhoneOff, Radio, Volume2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LIVE_INPUT_FRAMES_PER_CHUNK,
  LIVE_INPUT_SAMPLE_RATE,
  LIVE_OUTPUT_SAMPLE_RATE,
  decodePcm16LeBase64,
  encodePcm16LeBase64,
  createLiveInputResampler,
} from "@/lib/live-audio";
import { startLiveCapture } from "@/lib/live-capture";
import { createLiveMessageQueue, liveConnectionError, liveProviderError } from "@/lib/live-protocol";
import {
  buildLiveResumeContext,
  readLiveFunctionCalls,
  type LiveAgentHandoffResult,
  type LiveAgentRunState,
  type LiveExternalLinkResult,
  type LiveFunctionCall,
  type LiveModeUpdateResult,
  type LiveTranscriptLine,
  type LiveWorkspaceOpenResult,
} from "@/lib/live-agent-handoff";
import "./live-voice-dialog.css";

type LiveStatus = "idle" | "requesting" | "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error";
type TranscriptLine = { id: string; role: "user" | "assistant"; text: string; interim?: boolean };
const MAX_TRANSCRIPT_LINES = 100;
const MAX_TRANSCRIPT_LINE_CHARS = 4_000;
export type LiveSessionToken = { token: string; model: string };
export type LiveTokenFetcher = (signal: AbortSignal) => Promise<LiveSessionToken>;

type LiveSession = {
  stopped: boolean;
  socket?: WebSocket;
  stream?: MediaStream;
  audioContext?: AudioContext;
  tokenController?: AbortController;
  lifetime: AbortController;
  muted: boolean;
  closeMessages?: () => void;
  resampler?: ReturnType<typeof createLiveInputResampler>;
  playbackSources: Set<AudioBufferSourceNode>;
  nextPlaybackTime: number;
  inputSamples: number[];
  pendingAgentMessages: string[];
  setupTimer?: number;
  setupComplete: boolean;
  turnComplete: boolean;
  interactionStatus?: "IN_PROGRESS" | "IDLE";
  deepthink: boolean;
  pendingModeRestart: boolean;
  resumeContext?: string;
};

type StartSessionOptions = {
  preserveTranscript?: boolean;
  resumeContext?: string;
  pendingAgentMessages?: string[];
  modeSwitch?: boolean;
};

type LiveVoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchToken: LiveTokenFetcher;
  deepthink: boolean;
  agentMode: boolean;
  workspaceOpen: boolean;
  agentWork: LiveAgentRunState | null;
  onOpenSettings: () => void;
  onOpenWorkspace: () => LiveWorkspaceOpenResult;
  onBuildWithAgent: (transcript: LiveTranscriptLine[], task?: string) => LiveAgentHandoffResult;
  onSetDeepthink: (enabled: boolean) => LiveModeUpdateResult;
  onSetAgentMode: (enabled: boolean) => LiveModeUpdateResult;
  onOpenExternalLink: (target: string) => LiveExternalLinkResult;
};

type LiveTokenError = Error & { openProviderSettings?: boolean };

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function releaseSession(session: LiveSession) {
  if (session.stopped) return;
  session.stopped = true;
  if (session.setupTimer !== undefined) window.clearTimeout(session.setupTimer);
  session.closeMessages?.();
  session.lifetime.abort();
  session.tokenController?.abort(new Error("Live session closed"));
  const socket = session.socket;
  if (socket) {
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    try { socket.close(1000, "Nexo Live session ended"); } catch { /* connection already gone */ }
  }
  session.stream?.getTracks().forEach((track) => track.stop());
  for (const source of session.playbackSources) {
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    try { source.disconnect(); } catch { /* already disconnected */ }
  }
  session.playbackSources.clear();
  if (session.audioContext && session.audioContext.state !== "closed") {
    void session.audioContext.close().catch(() => {});
  }
  session.inputSamples.length = 0;
  session.pendingAgentMessages.length = 0;
  session.resampler?.reset();
}

function appendTranscript(
  linesRef: MutableRefObject<TranscriptLine[]>,
  setLines: Dispatch<SetStateAction<TranscriptLine[]>>,
  activeIds: MutableRefObject<{ user: string | null; assistant: string | null }>,
  role: TranscriptLine["role"],
  text: string,
  mode: "replace" | "append",
  interim = false,
) {
  const currentId = activeIds.current[role];
  const nextLines = [...linesRef.current];
  const currentIndex = currentId ? nextLines.findIndex((line) => line.id === currentId) : -1;
  if (currentIndex >= 0) {
    const currentLine = nextLines[currentIndex];
    const nextText = mode === "append" && !(currentLine.interim && !interim) ? `${currentLine.text}${text}` : text;
    nextLines[currentIndex] = { ...currentLine, text: nextText.slice(0, MAX_TRANSCRIPT_LINE_CHARS), interim };
  } else {
    const id = makeId();
    activeIds.current[role] = id;
    nextLines.push({ id, role, text: text.slice(0, MAX_TRANSCRIPT_LINE_CHARS), interim });
  }
  linesRef.current = nextLines.slice(-MAX_TRANSCRIPT_LINES);
  setLines(linesRef.current);
}

function flushPendingAgentMessage(session: LiveSession): "sent" | "waiting" | "failed" {
  const socket = session.socket;
  if (
    session.stopped || !session.setupComplete || !session.turnComplete || session.interactionStatus === "IN_PROGRESS" ||
    session.playbackSources.size > 0 || !socket || socket.readyState !== WebSocket.OPEN ||
    session.pendingAgentMessages.length === 0
  ) return "waiting";

  const text = session.pendingAgentMessages.shift()!;
  try {
    socket.send(JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    }));
    session.turnComplete = false;
    session.interactionStatus = "IN_PROGRESS";
    return "sent";
  } catch {
    session.pendingAgentMessages.unshift(text);
    return "failed";
  }
}

function queueAgentMessage(session: LiveSession, text: string): "queued" | "failed" {
  if (session.pendingAgentMessages.length >= 4) session.pendingAgentMessages.shift();
  session.pendingAgentMessages.push(text);
  return flushPendingAgentMessage(session) === "failed" ? "failed" : "queued";
}

export function LiveVoiceDialog({
  open, onOpenChange, fetchToken, deepthink, agentMode, workspaceOpen, agentWork, onOpenSettings,
  onOpenWorkspace, onBuildWithAgent, onSetDeepthink, onSetAgentMode, onOpenExternalLink,
}: LiveVoiceDialogProps) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState("");
  const [needsSettings, setNeedsSettings] = useState(false);
  const [muted, setMuted] = useState(false);
  const [externalLink, setExternalLink] = useState<{ label: string; url: string } | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const transcriptLinesRef = useRef<TranscriptLine[]>([]);
  const sessionRef = useRef<LiveSession | null>(null);
  const activeTranscriptIds = useRef<{ user: string | null; assistant: string | null }>({ user: null, assistant: null });
  const transcriptRef = useRef<HTMLElement>(null);
  const actionCallbacksRef = useRef({ onOpenWorkspace, onBuildWithAgent, onSetDeepthink, onSetAgentMode, onOpenExternalLink });
  actionCallbacksRef.current = { onOpenWorkspace, onBuildWithAgent, onSetDeepthink, onSetAgentMode, onOpenExternalLink };
  const modeStateRef = useRef({ deepthink, agentMode });
  modeStateRef.current = { deepthink, agentMode };
  const restartModeRef = useRef<((session: LiveSession) => void) | null>(null);
  const agentWorkRef = useRef(agentWork);
  agentWorkRef.current = agentWork;
  const announcedAgentWorkRef = useRef<string | null>(null);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const stopSession = useCallback(() => {
    const session = sessionRef.current;
    if (session) releaseSession(session);
    sessionRef.current = null;
    setStatus("idle");
    setMuted(false);
  }, []);

  useEffect(() => {
    if (!open) stopSession();
  }, [open, stopSession]);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (session) releaseSession(session);
    sessionRef.current = null;
  }, []);

  const failSession = useCallback((session: LiveSession, message: string) => {
    if (session.stopped || sessionRef.current !== session) return;
    setError(message);
    setStatus("error");
    setSwitchingMode(false);
    releaseSession(session);
  }, []);

  const handleToolCalls = useCallback((session: LiveSession, calls: LiveFunctionCall[]) => {
    if (session.stopped || !session.socket || session.socket.readyState !== WebSocket.OPEN) return;
    const functionResponses = calls.map((call) => {
      let result: Record<string, unknown>;
      try {
        if (call.name === "open_workspace") {
          const outcome = actionCallbacksRef.current.onOpenWorkspace();
          result = outcome.opened
            ? { status: "opened", message: "The existing workspace is open." }
            : { status: "unavailable", message: outcome.reason };
        } else if (call.name === "open_external_link") {
          const target = typeof call.args.target === "string" ? call.args.target.trim().slice(0, 2048) : "";
          const outcome = actionCallbacksRef.current.onOpenExternalLink(target);
          if (outcome.opened) {
            setExternalLink(null);
            result = { status: "opened", label: outcome.label, url: outcome.url, message: `Opened ${outcome.label} in a new tab.` };
          } else if ("url" in outcome) {
            setExternalLink({ label: outcome.label, url: outcome.url });
            result = { status: "popup_blocked", label: outcome.label, message: "The browser blocked the new tab. Tell the user to tap the open-link button visible in the Live panel." };
          } else {
            result = { status: "invalid_target", message: "Ask the user for a website name or valid HTTP(S) link." };
          }
        } else if (call.name === "set_deepthink") {
          if (typeof call.args.enabled !== "boolean") {
            result = { status: "invalid", message: "The Deepthink setting needs an on or off value." };
          } else {
            const outcome = actionCallbacksRef.current.onSetDeepthink(call.args.enabled);
            session.pendingModeRestart = session.deepthink !== outcome.enabled;
            result = {
              status: outcome.changed ? "updated" : "unchanged",
              enabled: outcome.enabled,
              message: outcome.changed
                ? `Deepthink is ${outcome.enabled ? "on" : "off"}. The app will reconnect this Live call with the selected model and restore the conversation.`
                : `Deepthink is already ${outcome.enabled ? "on" : "off"}.`,
            };
          }
        } else if (call.name === "set_agent_mode") {
          if (typeof call.args.enabled !== "boolean") {
            result = { status: "invalid", message: "The Agent setting needs an on or off value." };
          } else {
            const outcome = actionCallbacksRef.current.onSetAgentMode(call.args.enabled);
            result = {
              status: outcome.changed ? "updated" : "unchanged",
              enabled: outcome.enabled,
              message: `Agent mode is ${outcome.enabled ? "on" : "off"}. Explicit build requests can still be delegated while this voice session stays connected.`,
            };
          }
        } else if (call.name === "get_nexo_modes") {
          result = { status: "ok", ...modeStateRef.current };
        } else if (call.name === "start_agent") {
          if (agentWorkRef.current?.status === "running") {
            result = { status: "already_running", message: "An Agent build is already running in the workspace." };
          } else {
            const transcript: LiveTranscriptLine[] = transcriptLinesRef.current
              .filter((line) => !line.interim && line.text.trim())
              .map((line) => ({ role: line.role, text: line.text }));
            const requestedTask = typeof call.args.task === "string" ? call.args.task.trim().slice(0, 180) : "";
            if (!transcript.some((line) => line.role === "user") && requestedTask) {
              transcript.push({ role: "user", text: requestedTask });
            }
            const outcome = actionCallbacksRef.current.onBuildWithAgent(transcript, requestedTask || undefined);
            result = outcome.accepted
              ? { status: "started", message: "Nexo Agent is building in the workspace. Keep this Live session connected. Do not tell the user it is finished until the app sends a completion update." }
              : { status: "unavailable", message: outcome.reason };
          }
        } else {
          result = { status: "unsupported", message: "This Live action is not available." };
        }
      } catch {
        result = { status: "error", message: "The requested workspace action could not be started." };
      }
      return {
        name: call.name,
        ...(call.id ? { id: call.id } : {}),
        response: { result },
      };
    });
    try {
      session.socket.send(JSON.stringify({ toolResponse: { functionResponses } }));
    } catch {
      failSession(session, "Nexo Live could not hand the request to the workspace. Start a new call to continue.");
    }
  }, [failSession]);

  const handleServerMessage = useCallback((session: LiveSession, message: Record<string, unknown>) => {
    if (session.stopped || sessionRef.current !== session) return;
    if (message.error) {
      const failure = message.error as { code?: unknown; status?: unknown };
      failSession(session, liveProviderError(failure.code ?? failure.status));
      return;
    }
    const functionCalls = readLiveFunctionCalls(message);
    if (functionCalls.length) {
      session.turnComplete = false;
      session.interactionStatus = "IN_PROGRESS";
      handleToolCalls(session, functionCalls);
    }

    if (message.setupComplete) {
      if (session.setupComplete) return;
      session.setupComplete = true;
      const context = session.audioContext;
      const stream = session.stream;
      const socket = session.socket;
      if (!context || !stream || !socket) return;

      const sendPcm = (input: Float32Array) => {
        if (session.stopped || session.muted || socket.readyState !== WebSocket.OPEN) return;
        try {
          // Do not accumulate seconds of old speech during a connection stall.
          if (socket.bufferedAmount > 256_000) {
            failSession(session, "Your connection cannot keep up with Live audio. Check your connection and start a new call.");
            return;
          }
          const resampled = session.resampler!.process(input);
          for (const sample of resampled) session.inputSamples.push(sample);
          while (session.inputSamples.length >= LIVE_INPUT_FRAMES_PER_CHUNK && !session.stopped) {
            const chunk = session.inputSamples.splice(0, LIVE_INPUT_FRAMES_PER_CHUNK);
            socket.send(JSON.stringify({
              realtimeInput: {
                audio: {
                  data: encodePcm16LeBase64(chunk),
                  mimeType: `audio/pcm;rate=${LIVE_INPUT_SAMPLE_RATE}`,
                },
              },
            }));
          }
        } catch {
          failSession(session, "Nexo Live could not send microphone audio. Check your connection and start a new call.");
        }
      };

      void startLiveCapture({
        context, stream, signal: session.lifetime.signal, onSamples: sendPcm,
        onError: () => failSession(session, "Microphone capture stopped. Check your microphone permissions and start a new call."),
      }).then(() => {
        if (session.stopped) return;
        if (session.setupTimer !== undefined) window.clearTimeout(session.setupTimer);
        if (session.playbackSources.size === 0) setStatus("listening");
      }).catch(() => failSession(session, "Nexo Live could not capture microphone audio. Try another browser or microphone."));
      if (session.resumeContext) {
        try {
          socket.send(JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: session.resumeContext }] }],
              turnComplete: true,
            },
          }));
          session.resumeContext = undefined;
          session.turnComplete = false;
          session.interactionStatus = "IN_PROGRESS";
          setStatus("thinking");
          setSwitchingMode(false);
        } catch {
          failSession(session, "Nexo Live could not restore the previous conversation after switching modes.");
          return;
        }
      } else {
        setSwitchingMode(false);
      }
      restartModeRef.current?.(session);
      return;
    }

    if (message.goAway) {
      setStatus("ended");
      setError("Gemini is ending this Live session. Start a new call to continue.");
      releaseSession(session);
      return;
    }

    const serverContent = message.serverContent;
    const serverContentObject = typeof serverContent === "object" && serverContent !== null
      ? serverContent as Record<string, unknown>
      : null;
    const interactionStatus = message.interactionStatus ?? message.interaction_status ??
      serverContentObject?.interactionStatus ?? serverContentObject?.interaction_status;
    if (interactionStatus === "IN_PROGRESS" || interactionStatus === "IDLE") {
      session.interactionStatus = interactionStatus;
      if (interactionStatus === "IDLE" && flushPendingAgentMessage(session) === "failed") {
        failSession(session, "Nexo Live could not receive the Agent update. Start a new call to continue.");
        return;
      }
      if (session.playbackSources.size === 0) {
        if (interactionStatus === "IN_PROGRESS") setStatus("thinking");
        else if (session.turnComplete) setStatus("listening");
      }
    }
    if (typeof serverContent !== "object" || serverContent === null) {
      restartModeRef.current?.(session);
      return;
    }
    const content = serverContentObject!;
    const interimInput = content.interimInputTranscription as { text?: unknown } | undefined;
    const finalInput = content.inputTranscription as { text?: unknown } | undefined;
    const output = content.outputTranscription as { text?: unknown } | undefined;

    if (typeof interimInput?.text === "string" && interimInput.text) {
      const previous = transcriptLinesRef.current.find((line) => line.id === activeTranscriptIds.current.user);
      if (previous && !previous.interim) activeTranscriptIds.current.user = null;
      appendTranscript(transcriptLinesRef, setLines, activeTranscriptIds, "user", interimInput.text, "replace", true);
    }
    if (typeof finalInput?.text === "string" && finalInput.text) {
      appendTranscript(transcriptLinesRef, setLines, activeTranscriptIds, "user", finalInput.text, "append");
    }
    if (typeof output?.text === "string" && output.text) {
      appendTranscript(transcriptLinesRef, setLines, activeTranscriptIds, "assistant", output.text, "append");
    }

    if (content.interrupted === true) {
      for (const source of session.playbackSources) {
        source.onended = null;
        try { source.stop(); } catch { /* already stopped */ }
        try { source.disconnect(); } catch { /* already disconnected */ }
      }
      session.playbackSources.clear();
      session.nextPlaybackTime = 0;
      session.turnComplete = false;
      session.interactionStatus = "IDLE";
      activeTranscriptIds.current.assistant = null;
      setStatus("listening");
    }

    const modelTurn = content.modelTurn as { parts?: Array<Record<string, unknown>> } | undefined;
    if (Array.isArray(modelTurn?.parts) && session.audioContext && content.interrupted !== true) {
      for (const part of modelTurn.parts) {
        const inlineData = (part.inlineData ?? part.inline_data) as { data?: unknown; mimeType?: unknown; mime_type?: unknown } | undefined;
        if (typeof inlineData?.data !== "string") continue;
        try {
          const mimeType = typeof inlineData.mimeType === "string"
            ? inlineData.mimeType
            : typeof inlineData.mime_type === "string" ? inlineData.mime_type : "";
          const sampleRate = Number(/rate=(\d+)/i.exec(mimeType)?.[1] ?? LIVE_OUTPUT_SAMPLE_RATE);
          if (!/^audio\/pcm(?:;|$)/i.test(mimeType) || !Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) {
            throw new Error("Unsupported Live audio format");
          }
          const pcm = decodePcm16LeBase64(inlineData.data);
          if (
            Math.max(0, session.nextPlaybackTime - session.audioContext.currentTime) + pcm.length / sampleRate > 60 ||
            session.playbackSources.size >= 512
          ) throw new Error("Live playback queue overflow");
          const audioBuffer = session.audioContext.createBuffer(1, pcm.length, sampleRate);
          const channel = audioBuffer.getChannelData(0);
          for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32768;
          const source = session.audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(session.audioContext.destination);
          session.playbackSources.add(source);
          source.onended = () => {
            source.onended = null;
            source.disconnect();
            session.playbackSources.delete(source);
            if (!session.stopped && session.playbackSources.size === 0 && session.turnComplete) {
              setStatus(session.interactionStatus === "IN_PROGRESS" ? "thinking" : "listening");
              if (flushPendingAgentMessage(session) === "failed") {
                failSession(session, "Nexo Live could not receive the Agent update. Start a new call to continue.");
              }
              restartModeRef.current?.(session);
            }
          };
          const startAt = Math.max(session.nextPlaybackTime, session.audioContext.currentTime + 0.04);
          source.start(startAt);
          session.turnComplete = false;
          session.nextPlaybackTime = startAt + audioBuffer.duration;
          setStatus("speaking");
        } catch {
          failSession(session, "Nexo Live could not play an audio response. Check your device audio and start a new call.");
          return;
        }
      }
    }

    if (content.turnComplete === true) {
      session.turnComplete = true;
      activeTranscriptIds.current.assistant = null;
      activeTranscriptIds.current.user = null;
      if (session.playbackSources.size === 0) {
        setStatus(session.interactionStatus === "IN_PROGRESS" ? "thinking" : "listening");
      }
      if (flushPendingAgentMessage(session) === "failed") {
        failSession(session, "Nexo Live could not receive the Agent update. Start a new call to continue.");
      }
    } else if (content.waitingForInput === true && session.playbackSources.size === 0) {
      setStatus(session.interactionStatus === "IN_PROGRESS" ? "thinking" : "listening");
    }
    restartModeRef.current?.(session);
  }, [failSession, handleToolCalls]);

  useEffect(() => {
    if (!agentWork || agentWork.status === "running" || announcedAgentWorkRef.current === agentWork.id) return;
    announcedAgentWorkRef.current = agentWork.id;
    const session = sessionRef.current;
    if (!session || session.stopped) return;
    const update = agentWork.status === "finished"
      ? "Internal Nexo workspace update: the Agent run has finished. The generated code and any preview or run results are in the workspace. Tell the user the workspace is ready, without reading code aloud, and ask what they would like changed."
      : "Internal Nexo workspace update: the Agent run ended without completing. Tell the user it did not finish, that any saved progress remains in the workspace, and ask whether they want to retry or revise the request.";
    if (queueAgentMessage(session, update) === "failed") {
      failSession(session, "Nexo Live could not announce the Agent result. Start a new call to continue.");
    }
  }, [agentWork, failSession]);

  const startSession = useCallback(async (options: StartSessionOptions = {}) => {
    if (sessionRef.current && !sessionRef.current.stopped) return;
    setError("");
    setNeedsSettings(false);
    setMuted(false);
    setSwitchingMode(options.modeSwitch === true);
    if (!options.preserveTranscript) {
      transcriptLinesRef.current = [];
      setLines([]);
    }
    activeTranscriptIds.current = { user: null, assistant: null };
    setStatus("requesting");

    const session: LiveSession = {
      stopped: false,
      lifetime: new AbortController(),
      muted: false,
      playbackSources: new Set(),
      nextPlaybackTime: 0,
      inputSamples: [],
      pendingAgentMessages: options.pendingAgentMessages ?? [],
      setupComplete: false,
      turnComplete: false,
      interactionStatus: undefined,
      deepthink,
      pendingModeRestart: false,
      resumeContext: options.resumeContext,
    };
    sessionRef.current = session;
    const deadline = (milliseconds: number, message: string) => {
      if (session.setupTimer !== undefined) window.clearTimeout(session.setupTimer);
      session.setupTimer = window.setTimeout(() => failSession(session, message), milliseconds);
    };
    deadline(30_000, "Microphone access took too long. Allow microphone access in your browser and start a new call.");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot access a microphone. Use a current browser over HTTPS.");
      }
      const audioContext = new AudioContext({ latencyHint: "interactive" });
      session.audioContext = audioContext;
      session.resampler = createLiveInputResampler(audioContext.sampleRate);
      await audioContext.resume();
      if (session.stopped) return;
      if (audioContext.state !== "running") throw new Error("Your browser blocked audio playback. Allow sound for this site and start a new call.");

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      session.stream = mediaStream;
      if (session.stopped) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStream.getAudioTracks().forEach((track) => { track.enabled = !session.muted; });

      setStatus("connecting");
      deadline(12_000, "Nexo Live took too long to prepare. Check your connection and try again.");
      const tokenController = new AbortController();
      session.tokenController = tokenController;
      const { token, model } = await fetchToken(tokenController.signal);
      if (session.stopped) return;
      const socketUrl = new URL("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained");
      socketUrl.searchParams.set("access_token", token);
      const socket = new WebSocket(socketUrl);
      socket.binaryType = "arraybuffer";
      session.socket = socket;
      deadline(18_000, "Gemini Live did not connect in time. Check the key’s Live API access and try again.");
      const messages = createLiveMessageQueue(
        (message) => handleServerMessage(session, message),
        () => failSession(session, "Nexo Live received unreadable or excessive data. Start a new call to try again."),
      );
      session.closeMessages = messages.close;

      socket.onopen = () => {
        if (session.stopped) return;
        try { socket.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
            ...(session.deepthink ? { thinkingConfig: { thinkingLevel: "high" } } : {}),
              },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        })); } catch {
          failSession(session, "Nexo Live could not start the connection. Check your connection and try again.");
        }
      };
      socket.onmessage = (event) => messages.push(event.data);
      socket.onerror = () => {
        failSession(session, liveConnectionError(1006, session.setupComplete));
      };
      socket.onclose = (event) => {
        if (session.stopped) return;
        failSession(session, liveConnectionError(event.code, session.setupComplete));
      };
    } catch (reason) {
      if (session.stopped) return;
      const failure: LiveTokenError = reason instanceof Error
        ? reason as LiveTokenError
        : new Error("Nexo Live could not start. Please try again.");
      setError(failure.name === "NotAllowedError"
        ? "Microphone access was blocked. Allow microphone access in your browser settings, then start a new call."
        : failure.name === "NotFoundError"
          ? "No microphone was found. Connect a microphone and start a new call."
          : failure.name === "NotReadableError"
            ? "Your microphone is busy or unavailable. Close other apps using it, then start a new call."
            : failure.message);
      setNeedsSettings(failure.openProviderSettings === true);
      setStatus("error");
      setSwitchingMode(false);
      releaseSession(session);
    }
  }, [deepthink, fetchToken, handleServerMessage, failSession]);

  const restartSessionForMode = useCallback((session: LiveSession) => {
    if (session.stopped || sessionRef.current !== session || session.deepthink === deepthink) return;
    const hasTranscript = transcriptLinesRef.current.some((line) => !line.interim && line.text.trim());
    const safeToRestart = session.setupComplete &&
      session.playbackSources.size === 0 &&
      session.interactionStatus !== "IN_PROGRESS" &&
      (session.turnComplete || !hasTranscript);
    if (!safeToRestart) return;

    const resumeContext = buildLiveResumeContext(transcriptLinesRef.current);
    const pendingAgentMessages = [...session.pendingAgentMessages];
    session.pendingModeRestart = false;
    setExternalLink(null);
    setError("");
    setSwitchingMode(true);
    appendTranscript(
      transcriptLinesRef,
      setLines,
      activeTranscriptIds,
      "assistant",
      `Switching to ${deepthink ? "Deepthink Live" : "standard Live"} and keeping our conversation.`,
      "append",
    );
    releaseSession(session);
    if (sessionRef.current === session) sessionRef.current = null;
    activeTranscriptIds.current = { user: null, assistant: null };
    void startSession({
      preserveTranscript: true,
      resumeContext,
      pendingAgentMessages,
      modeSwitch: true,
    });
  }, [deepthink, startSession]);
  restartModeRef.current = restartSessionForMode;

  useEffect(() => {
    const session = sessionRef.current;
    if (!open || !session || session.stopped || session.deepthink === deepthink) return;
    session.pendingModeRestart = true;
    restartModeRef.current?.(session);
  }, [deepthink, lines, open, status]);

  const toggleMute = () => {
    const session = sessionRef.current;
    if (!session || session.stopped) return;
    const nextMuted = !session.muted;
    session.muted = nextMuted;
    session.stream?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    session.inputSamples.length = 0;
    session.resampler?.reset();
    if (nextMuted && session.setupComplete && session.socket?.readyState === WebSocket.OPEN) {
      try { session.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); }
      catch { failSession(session, "Nexo Live lost its connection. Start a new call to continue."); }
    }
    setMuted(nextMuted);
  };

  const canStart = status === "idle" || status === "ended" || status === "error";
  const canBuildWithAgent = lines.some((line) => line.role === "user" && !line.interim && line.text.trim());
  const statusText: Record<LiveStatus, string> = {
    idle: "Ready when you are",
    requesting: switchingMode ? "Switching Live mode" : "Preparing your microphone",
    connecting: switchingMode ? `Connecting to ${deepthink ? "Deepthink Live" : "standard Live"}` : "Connecting to Gemini Live",
    listening: "Listening",
    thinking: "Thinking through your request",
    speaking: "Nexo is speaking",
    ended: "Session ended",
    error: "Could not connect",
  };
  const openWorkspace = () => {
    const result = actionCallbacksRef.current.onOpenWorkspace();
    if (!result.opened) setError(result.reason);
  };
  const startAgentFromTranscript = (transcript: LiveTranscriptLine[]) => {
    const task = [...transcript].reverse().find((line) => line.role === "user")?.text;
    const result = actionCallbacksRef.current.onBuildWithAgent(transcript, task);
    if (!result.accepted) setError(result.reason);
  };

  return (
    <Dialog open={open} modal={!workspaceOpen} onOpenChange={(nextOpen) => {
      if (!nextOpen) stopSession();
      onOpenChange(nextOpen);
    }}>
      <DialogContent
        className={`live-dialog-content${workspaceOpen ? " live-agent-docked" : ""}`}
        overlayClassName={workspaceOpen ? "live-agent-overlay" : undefined}
        onPointerDownOutside={(event) => { if (workspaceOpen) event.preventDefault(); }}
      >
        <DialogHeader className="live-dialog-header">
          <div className="live-brand-mark" aria-hidden="true"><Radio size={18} /></div>
          <div>
            <DialogTitle>Nexo Live</DialogTitle>
            <DialogDescription>
              {deepthink
                ? "Deepthink Live uses Gemini 3.8 Live Extended Thinking for complex, multi-step responses."
                : "Standard Live uses Gemini 3.8 Live for low-latency conversation."} Live audio is not saved; requests you send to Agent are added to chat history.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="live-mode-controls" role="group" aria-label="Live mode and workspace controls">
          <button
            type="button"
            className={`live-mode-button${deepthink ? " is-on" : ""}`}
            aria-pressed={deepthink}
            aria-label="Deepthink mode"
            title={deepthink ? "Deepthink is on. Select to turn it off." : "Deepthink is off. Select to use extended thinking."}
            data-testid="toggle-live-deepthink"
            onClick={() => actionCallbacksRef.current.onSetDeepthink(!deepthink)}
          >
            <Brain size={14} aria-hidden="true" /> Deepthink
          </button>
          <button
            type="button"
            className={`live-mode-button${agentMode ? " is-on" : ""}`}
            aria-pressed={agentMode}
            aria-label="Agent mode"
            title={agentMode ? "Agent mode is on. Select to turn it off." : "Agent mode is off. Select to turn it on."}
            data-testid="toggle-live-agent"
            onClick={() => actionCallbacksRef.current.onSetAgentMode(!agentMode)}
          >
            <Bot size={14} aria-hidden="true" /> Agent
          </button>
          <button
            type="button"
            className="live-mode-button"
            aria-label="Open workspace"
            title="Open the current conversation's workspace"
            data-testid="button-live-open-workspace"
            onClick={openWorkspace}
          >
            <ExternalLink size={13} aria-hidden="true" /> Workspace
          </button>
        </div>

        <div className={`live-voice-orb is-${status}`} aria-hidden="true">
          <span className="live-orb-halo" />
          <span className="live-orb-core">{status === "requesting" || status === "connecting" ? <Loader2 size={28} /> : <Radio size={28} />}</span>
        </div>
        <div className="live-status" role="status" aria-live="polite">
          <span className={`live-status-dot is-${status}`} />
          {statusText[status]}
        </div>

        {error && (
          <div className="live-error" role="alert">
            <span>{error}</span>
            {needsSettings && <button type="button" onClick={onOpenSettings}>Open Settings</button>}
          </div>
        )}

        {externalLink && (
          <div className="live-external-link" role="status" data-testid="status-live-external-link">
            <span>The browser blocked the new tab. Open the page here:</span>
            <a href={externalLink.url} target="_blank" rel="noopener noreferrer" onClick={() => setExternalLink(null)}>
              <ExternalLink size={13} aria-hidden="true" /> {externalLink.label}
            </a>
          </div>
        )}

        {agentWork && (
          <div className={`live-agent-progress is-${agentWork.status}`} role="status" aria-live="polite" data-testid="status-live-agent">
            <span className="live-agent-progress-dot" aria-hidden="true" />
            <div className="live-agent-progress-copy">
              <strong>{agentWork.status === "running" ? "Agent is building" : agentWork.status === "finished" ? "Agent run finished" : "Agent needs attention"}</strong>
              <span>{agentWork.status === "running"
                ? "The workspace is open. Keep talking while it works."
                : agentWork.status === "finished"
                  ? "The code and preview are in the workspace."
                  : "Any saved progress remains in the workspace."}</span>
            </div>
            {!workspaceOpen && (
              <button type="button" className="live-agent-open-workspace" onClick={openWorkspace}>
                Open workspace
              </button>
            )}
          </div>
        )}

        <section ref={transcriptRef} className="live-transcript" aria-label="Live transcript">
          {lines.length === 0 ? (
            <p className="live-transcript-empty">{status === "idle" ? "Your conversation will appear here." : "Speak naturally. Nexo will respond as you talk."}</p>
          ) : lines.map((line) => (
            <p className={`live-transcript-line is-${line.role}${line.interim ? " is-interim" : ""}`} key={line.id}>
              <span>{line.role === "user" ? "You" : "Nexo"}</span>
              {line.text}
            </p>
          ))}
        </section>

        <div className="live-controls">
          {canStart ? (
            <button type="button" className="live-start-button" onClick={() => void startSession()}>
              {status === "idle" ? <Mic size={17} /> : <Radio size={17} />}
              {status === "idle" ? "Start talking" : "Start a new call"}
            </button>
          ) : (
            <>
              <button type="button" className={`live-control-button${muted ? " is-muted" : ""}`} onClick={toggleMute} aria-label={muted ? "Unmute microphone" : "Mute microphone"} title={muted ? "Unmute microphone" : "Mute microphone"}>
                {muted ? <MicOff size={17} /> : <Mic size={17} />}
              </button>
              <div className="live-audio-note"><Volume2 size={14} /> Audio is playing on this device</div>
              <button type="button" className="live-end-button" onClick={() => { stopSession(); setStatus("ended"); }} aria-label="End Live session">
                <PhoneOff size={16} /><span>End call</span>
              </button>
            </>
          )}
        </div>
        {canBuildWithAgent && (
          <button
            type="button"
            className="live-agent-button"
            data-testid="button-live-build-agent"
            aria-label="Continue this voice request with Nexo Agent"
            title="Start Agent without ending the Live conversation"
            disabled={agentWork?.status === "running"}
            onClick={() => {
              const transcript = transcriptLinesRef.current.filter((line) => !line.interim && line.text.trim());
              if (!transcript.some((line) => line.role === "user")) return;
              startAgentFromTranscript(transcript);
            }}
          >
            <Bot size={16} aria-hidden="true" />
            {agentWork?.status === "running" ? "Agent is working" : "Build with Agent"}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
