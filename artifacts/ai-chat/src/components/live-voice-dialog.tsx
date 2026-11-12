import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Radio, Volume2 } from "lucide-react";
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
  setupTimer?: number;
  setupComplete: boolean;
  turnComplete: boolean;
  interactionStatus?: "IN_PROGRESS" | "IDLE";
};

type LiveVoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchToken: LiveTokenFetcher;
  deepthink: boolean;
  onOpenSettings: () => void;
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

export function LiveVoiceDialog({ open, onOpenChange, fetchToken, deepthink, onOpenSettings }: LiveVoiceDialogProps) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState("");
  const [needsSettings, setNeedsSettings] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const transcriptLinesRef = useRef<TranscriptLine[]>([]);
  const sessionRef = useRef<LiveSession | null>(null);
  const activeTranscriptIds = useRef<{ user: string | null; assistant: string | null }>({ user: null, assistant: null });
  const transcriptRef = useRef<HTMLElement>(null);

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
    releaseSession(session);
  }, []);

  const handleServerMessage = useCallback((session: LiveSession, message: Record<string, unknown>) => {
    if (session.stopped || sessionRef.current !== session) return;
    if (message.error) {
      const failure = message.error as { code?: unknown; status?: unknown };
      failSession(session, liveProviderError(failure.code ?? failure.status));
      return;
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
      if (session.playbackSources.size === 0) {
        if (interactionStatus === "IN_PROGRESS") setStatus("thinking");
        else if (session.turnComplete) setStatus("listening");
      }
    }
    if (typeof serverContent !== "object" || serverContent === null) return;
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
    } else if (content.waitingForInput === true && session.playbackSources.size === 0) {
      setStatus(session.interactionStatus === "IN_PROGRESS" ? "thinking" : "listening");
    }
  }, [failSession]);

  const startSession = useCallback(async () => {
    if (sessionRef.current && !sessionRef.current.stopped) return;
    setError("");
    setNeedsSettings(false);
    setMuted(false);
    transcriptLinesRef.current = [];
    setLines([]);
    activeTranscriptIds.current = { user: null, assistant: null };
    setStatus("requesting");

    const session: LiveSession = {
      stopped: false,
      lifetime: new AbortController(),
      muted: false,
      playbackSources: new Set(),
      nextPlaybackTime: 0,
      inputSamples: [],
      setupComplete: false,
      turnComplete: false,
      interactionStatus: undefined,
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
                ...(deepthink ? { thinkingConfig: { thinkingLevel: "high" } } : {}),
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
      releaseSession(session);
    }
  }, [deepthink, fetchToken, handleServerMessage, failSession]);

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
  const statusText: Record<LiveStatus, string> = {
    idle: "Ready when you are",
    requesting: "Preparing your microphone",
    connecting: "Connecting to Gemini Live",
    listening: "Listening",
    thinking: "Thinking through your request",
    speaking: "Nexo is speaking",
    ended: "Session ended",
    error: "Could not connect",
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) stopSession();
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="live-dialog-content">
        <DialogHeader className="live-dialog-header">
          <div className="live-brand-mark" aria-hidden="true"><Radio size={18} /></div>
          <div>
            <DialogTitle>Nexo Live</DialogTitle>
            <DialogDescription>
              {deepthink
                ? "Deepthink Live uses Gemini 3.8 Live Extended Thinking for complex, multi-step responses."
                : "Standard Live uses Gemini 3.8 Live for low-latency conversation."} Your voice session is not saved to chat history.
            </DialogDescription>
          </div>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
