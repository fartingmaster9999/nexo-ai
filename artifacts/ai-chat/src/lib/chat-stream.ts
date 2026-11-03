import type { Activity, Source, Notice } from '../components/answer-details';

export type StreamEvent = { content?: string; reasoning?: string; done?: boolean; error?: string; activity?: Activity; sources?: Source[]; notice?: Notice; model?: string };

/** Incremental SSE decoding: UTF-8, LF/CRLF, comments, and split frames. */
export class ChatEventDecoder {
  private pending = '';
  private decoder = new TextDecoder();
  push(bytes?: Uint8Array): StreamEvent[] {
    this.pending += bytes ? this.decoder.decode(bytes, { stream: true }) : this.decoder.decode();
    if (this.pending.length > 1_000_000) throw new Error('The response stream contained an oversized event.');
    const blocks = this.pending.split(/\r?\n\r?\n/);
    this.pending = blocks.pop() ?? '';
    if (!bytes && this.pending.trim()) { blocks.push(this.pending); this.pending = ''; }
    return blocks.flatMap(block => {
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (!data) return [];
      if (data === '[DONE]') return [{ done: true }];
      let value: unknown;
      try { value = JSON.parse(data); } catch { throw new Error('The server sent an invalid response event. Your partial answer is kept.'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The server sent an invalid response event.');
      const event = value as StreamEvent;
      for (const key of ['content', 'reasoning', 'error', 'model'] as const) {
        if (event[key] !== undefined && typeof event[key] !== 'string') throw new Error('The server sent an invalid response event.');
      }
      if (event.done !== undefined && typeof event.done !== 'boolean') throw new Error('The server sent an invalid response event.');
      return [event];
    });
  }
}

/** Cancel the fetch as well as the pending read; heartbeat bytes reset idle time. */
export async function consumeChatStream(
  body: ReadableStream<Uint8Array>, controller: AbortController,
  accept: (event: StreamEvent) => void, idleMs = 45000,
): Promise<void> {
  const reader = body.getReader();
  const parser = new ChatEventDecoder();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(new Error('The connection stalled. Your partial answer is kept; please try again.')), idleMs);
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', abort, { once: true });
  try {
    reset();
    while (true) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const { value, done } = await reader.read();
      if (controller.signal.aborted) throw controller.signal.reason;
      reset();
      const events = parser.push(done ? undefined : value);
      for (const event of events) {
        accept(event);
        if (event.done) return;
      }
      if (done) throw new Error('The connection closed before the response finished. Your partial answer is kept.');
    }
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
