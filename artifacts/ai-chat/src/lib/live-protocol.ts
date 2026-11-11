const MAX_MESSAGE_BYTES = 1_048_576;
const MAX_QUEUE_BYTES = 4 * MAX_MESSAGE_BYTES;
const MAX_QUEUE_MESSAGES = 64;

/** Browser WebSockets deliver JSON as strings, Blobs, or ArrayBuffers. Decode serially. */
export function createLiveMessageQueue(
  onMessage: (message: Record<string, unknown>) => void,
  onError: () => void,
) {
  let stopped = false;
  let draining = false;
  let queuedBytes = 0;
  const queue: Array<{ data: string | Blob | ArrayBuffer; bytes: number }> = [];
  const close = () => {
    stopped = true;
    queue.length = 0;
    queuedBytes = 0;
  };
  const fail = () => {
    if (stopped) return;
    close();
    onError();
  };
  const drain = async () => {
    if (draining || stopped) return;
    draining = true;
    try {
      while (!stopped && queue.length) {
        const item = queue.shift()!;
        const text = typeof item.data === "string" ? item.data
          : item.data instanceof Blob ? await item.data.text()
          : new TextDecoder("utf-8", { fatal: true }).decode(item.data);
        if (stopped) break;
        queuedBytes -= item.bytes;
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Live message");
        onMessage(parsed as Record<string, unknown>);
      }
    } catch {
      fail();
    } finally {
      draining = false;
    }
  };
  return {
    close,
    push(data: unknown) {
      if (stopped) return;
      const bytes = typeof data === "string" ? data.length * 2
        : data instanceof Blob ? data.size
        : data instanceof ArrayBuffer ? data.byteLength : -1;
      if (bytes < 0 || bytes > MAX_MESSAGE_BYTES || queuedBytes + bytes > MAX_QUEUE_BYTES || queue.length >= MAX_QUEUE_MESSAGES) {
        fail();
        return;
      }
      queue.push({ data: data as string | Blob | ArrayBuffer, bytes });
      queuedBytes += bytes;
      void drain();
    },
  };
}

/** Never display provider close reasons: they may contain session credentials. */
export function liveConnectionError(code: number, connected: boolean): string {
  if (code === 1008 || code === 1007) {
    return "Gemini rejected this Live session. Check the Gemini key’s Live API access and model permissions, then start a new call.";
  }
  if (code === 1011 || code === 1013) {
    return "Gemini Live is temporarily unavailable or busy. Wait a moment and start a new call.";
  }
  return connected
    ? "The Live connection ended. Check your connection and start a new call."
    : "Nexo Live could not connect. Check your connection and the Gemini key’s Live API access.";
}

export function liveProviderError(code: unknown): string {
  if (code === 429 || code === "RESOURCE_EXHAUSTED") return "Gemini Live is temporarily rate-limited. Wait a moment and start a new call.";
  if (code === 401 || code === 403 || code === "PERMISSION_DENIED" || code === "UNAUTHENTICATED") {
    return "Gemini denied Live access. Check that the Gemini key is valid and has permission to use the Live API.";
  }
  if (code === 400 || code === 404 || code === "INVALID_ARGUMENT" || code === "NOT_FOUND") {
    return "Gemini could not accept the Live configuration. Check that the Live model is available to this Gemini account.";
  }
  return "Gemini Live could not continue this call. Start a new call to try again.";
}
