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
  resampleMonoToLiveInput,
} from "@/lib/live-audio";
import "./live-voice-dialog.css";

type LiveStatus = "idle" | "requesting" | "connecting" | "listening" | "speaking" | "ended" | "error";
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
  nodes: AudioNode[];
  playbackSources: Set<AudioBufferSourceNode>;
  nextPlaybackTime: number;
  inputSamples: number[];
  setupTimer?: number;
  setupComplete: boolean;
  turnComplete: boolean;
};

type LiveVoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchToken: LiveTokenFetcher;
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
  session.tokenController?.abort(new Error("Live session closed"));
  session.socket?.close(1000, "Nexo Live session ended");
  session.stream?.getTracks().forEach((track) => track.stop());
  for (const source of session.playbackSources) {
    try { source.stop(); } catch { /* already stopped */ }
  }
  session.playbackSources.clear();
  session.nodes.forEach((node) => {
    try { node.disconnect(); } catch { /* already disconnected */ }
  });
  if (session.audioContext && session.audioContext.state !== "closed") {
    void session.audioContext.close().catch(() => {});
  }
  session.inputSamples.length = 0;
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
    const nextText = mode === "append" ? `${currentLine.text}${text}` : text;
    nextLines[currentIndex] = { ...currentLine, text: nextText.slice(0, MAX_TRANSCRIPT_LINE_CHARS), interim };
  } else {
    const id = makeId();
    activeIds.current[role] = id;
    nextLines.push({ id, role, text: text.slice(0, MAX_TRANSCRIPT_LINE_CHARS), interim });
  }
  if (!interim && role === "user") activeIds.current.user = null;
  linesRef.current = nextLines.slice(-MAX_TRANSCRIPT_LINES);
  setLines(linesRef.current);
}

export function LiveVoiceDialog({ open, onOpenChange, fetchToken, onOpenSettings }: LiveVoiceDialogProps) {
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

  const handleServerMessage = useCallback((session: LiveSession, raw: unknown) => {
    if (session.stopped || typeof raw !== "string") return;
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return;
      message = parsed as Record<string, unknown>;
    } catch {
      setError("Nexo Live received an unreadable message. End the call and try again.");
      return;
    }

    if (message.setupComplete) {
      session.setupComplete = true;
      if (session.setupTimer !== undefined) window.clearTimeout(session.setupTimer);
      setStatus("listening");
      const context = session.audioContext;
      const stream = session.stream;
      const socket = session.socket;
      if (!context || !stream || !socket) return;

      const sendPcm = (input: Float32Array) => {
        if (session.stopped || !session.setupComplete || socket.readyState !== WebSocket.OPEN) return;
        const resampled = resampleMonoToLiveInput(input, context.sampleRate);
        for (const sample of resampled) session.inputSamples.push(sample);
        while (session.inputSamples.length >= LIVE_INPUT_FRAMES_PER_CHUNK && socket.readyState === WebSocket.OPEN) {
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
      };

      const source = context.createMediaStreamSource(stream);
      const silence = context.createGain();
      silence.gain.value = 0;
      session.nodes.push(source, silence);
      if (context.audioWorklet) {
        const processorSource = `
          class NexoLiveInput extends AudioWorkletProcessor {
            process(inputs) {
              const channel = inputs[0] && inputs[0][0];
              if (channel && channel.length) {
                const copy = channel.slice();
                this.port.postMessage(copy, [copy.buffer]);
              }
              return true;
            }
          }
          registerProcessor("nexo-live-input", NexoLiveInput);
        `;
        const moduleUrl = URL.createObjectURL(new Blob([processorSource], { type: "text/javascript" }));
        void context.audioWorklet.addModule(moduleUrl).then(() => {
          URL.revokeObjectURL(moduleUrl);
          if (session.stopped || !session.setupComplete) return;
          const worklet = new AudioWorkletNode(context, "nexo-live-input");
          worklet.port.onmessage = (event: MessageEvent<Float32Array>) => sendPcm(event.data);
          source.connect(worklet);
          worklet.connect(silence);
          session.nodes.push(worklet);
        }).catch(() => {
          URL.revokeObjectURL(moduleUrl);
          if (session.stopped || !session.setupComplete) return;
          const processor = context.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (event) => sendPcm(event.inputBuffer.getChannelData(0));
          source.connect(processor);
          processor.connect(silence);
          session.nodes.push(processor);
        });
      } else {
        const processor = context.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => sendPcm(event.inputBuffer.getChannelData(0));
        source.connect(processor);
        processor.connect(silence);
        session.nodes.push(processor);
      }
      silence.connect(context.destination);
      return;
    }

    if (message.goAway) {
      setStatus("ended");
      setError("Gemini is ending this Live session. Start a new call to continue.");
      releaseSession(session);
      return;
    }

    const serverContent = message.serverContent;
    if (typeof serverContent !== "object" || serverContent === null) return;
    const content = serverContent as Record<string, unknown>;
    const interimInput = content.interimInputTranscription as { text?: unknown } | undefined;
    const finalInput = content.inputTranscription as { text?: unknown } | undefined;
    const output = content.outputTranscription as { text?: unknown } | undefined;

    if (typeof interimInput?.text === "string" && interimInput.text) {
      appendTranscript(transcriptLinesRef, setLines, activeTranscriptIds, "user", interimInput.text, "replace", true);
    }
    if (typeof finalInput?.text === "string" && finalInput.text) {
      appendTranscript(transcriptLinesRef, setLines, activeTranscriptIds, "user", finalInput.text, "replace");
    }
    if (typeof output?.text === "string" && output.text) {
      appendTranscript(transcriptLinesRef, setLines, activeTranscriptIds, "assistant", output.text, "append");
    }

    if (content.interrupted === true) {
      for (const source of session.playbackSources) {
        try { source.stop(); } catch { /* already stopped */ }
      }
      session.playbackSources.clear();
      session.nextPlaybackTime = 0;
      session.turnComplete = false;
      activeTranscriptIds.current.assistant = null;
      setStatus("listening");
    }

    const modelTurn = content.modelTurn as { parts?: Array<Record<string, unknown>> } | undefined;
    if (modelTurn?.parts && session.audioContext) {
      for (const part of modelTurn.parts) {
        const inlineData = (part.inlineData ?? part.inline_data) as { data?: unknown; mimeType?: unknown; mime_type?: unknown } | undefined;
        if (typeof inlineData?.data !== "string") continue;
        try {
          const pcm = decodePcm16LeBase64(inlineData.data);
          const mimeType = typeof inlineData.mimeType === "string"
            ? inlineData.mimeType
            : typeof inlineData.mime_type === "string" ? inlineData.mime_type : "";
          const sampleRate = Number(/rate=(\d+)/i.exec(mimeType)?.[1] ?? LIVE_OUTPUT_SAMPLE_RATE);
          const audioBuffer = session.audioContext.createBuffer(1, pcm.length, sampleRate);
          const channel = audioBuffer.getChannelData(0);
          for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 32768;
          const source = session.audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(session.audioContext.destination);
          session.playbackSources.add(source);
          source.onended = () => {
            session.playbackSources.delete(source);
            if (!session.stopped && session.playbackSources.size === 0 && session.turnComplete) {
              setStatus("listening");
            }
          };
          const startAt = Math.max(session.nextPlaybackTime, session.audioContext.currentTime + 0.04);
          source.start(startAt);
          session.turnComplete = false;
          session.nextPlaybackTime = startAt + audioBuffer.duration;
          setStatus("speaking");
        } catch {
          setError("Nexo Live could not play an audio response. Check your device audio and try again.");
        }
      }
    }

    if (content.turnComplete === true) {
      session.turnComplete = true;
      activeTranscriptIds.current.assistant = null;
      if (session.playbackSources.size === 0) setStatus("listening");
    } else if (content.waitingForInput === true && session.playbackSources.size === 0) {
      setStatus("listening");
    }
  }, []);

  const startSession = useCallback(async () => {
    if (sessionRef.current && !sessionRef.current.stopped) return;
    setError("");
    setNeedsSettings(false);
    transcriptLinesRef.current = [];
    setLines([]);
    activeTranscriptIds.current = { user: null, assistant: null };
    setStatus("requesting");

    const session: LiveSession = {
      stopped: false,
      nodes: [],
      playbackSources: new Set(),
      nextPlaybackTime: 0,
      inputSamples: [],
      setupComplete: false,
      turnComplete: false,
    };
    sessionRef.current = session;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot access a microphone. Use a current browser over HTTPS.");
      }
      let audioContext: AudioContext;
      try {
        audioContext = new AudioContext({ sampleRate: 16_000 });
      } catch {
        audioContext = new AudioContext();
      }
      session.audioContext = audioContext;
      await audioContext.resume();
      if (session.stopped) return;

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      session.stream = mediaStream;
      if (session.stopped) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      setStatus("connecting");
      const tokenController = new AbortController();
      session.tokenController = tokenController;
      const { token, model } = await fetchToken(tokenController.signal);
      if (session.stopped) return;
      const socketUrl = new URL("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained");
      socketUrl.searchParams.set("access_token", token);
      const socket = new WebSocket(socketUrl);
      session.socket = socket;
      session.setupTimer = window.setTimeout(() => {
        if (!session.stopped && !session.setupComplete) {
          setError("Gemini Live did not connect in time. Check your key and try again.");
          setStatus("error");
          releaseSession(session);
        }
      }, 18_000);

      socket.onopen = () => {
        if (session.stopped) return;
        socket.send(JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ["AUDIO"] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }));
      };
      socket.onmessage = (event) => handleServerMessage(session, event.data);
      socket.onerror = () => {
        if (session.stopped) return;
        setError("Nexo Live could not connect to Gemini. Check your internet connection and API key.");
        setStatus("error");
        releaseSession(session);
      };
      socket.onclose = () => {
        if (session.stopped) return;
        setError("The Live connection ended. Start a new call to continue.");
        setStatus("ended");
        releaseSession(session);
      };
    } catch (reason) {
      if (session.stopped) return;
      const failure: LiveTokenError = reason instanceof Error
        ? reason as LiveTokenError
        : new Error("Nexo Live could not start. Please try again.");
      setError(failure.message);
      setNeedsSettings(failure.openProviderSettings === true);
      setStatus("error");
      releaseSession(session);
    }
  }, [fetchToken, handleServerMessage]);

  const toggleMute = () => {
    const nextMuted = !muted;
    const track = sessionRef.current?.stream?.getAudioTracks()[0];
    if (track) track.enabled = !nextMuted;
    setMuted(nextMuted);
  };

  const canStart = status === "idle" || status === "ended" || status === "error";
  const statusText: Record<LiveStatus, string> = {
    idle: "Ready when you are",
    requesting: "Preparing your microphone",
    connecting: "Connecting to Gemini Live",
    listening: "Listening",
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
            <DialogDescription>Talk with Nexo in real time. Your voice session is not saved to chat history.</DialogDescription>
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
