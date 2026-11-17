import type { Activity, AgentTask, Source, Notice } from '../components/answer-details';
import type { RunLanguage } from './code-runner';
import { validateProjectEdits, type ProjectEdit } from '@workspace/api-zod/project-edits';
import { validateProjectFiles, type ProjectFile } from './project-workspace.ts';

export type AgentToolExchange = {
  tool: 'web_search' | 'run_code' | 'write_project' | 'edit_project';
  callId: string;
  thoughtSignature: string;
  arguments: { query?: string; language?: RunLanguage; code?: string; entrypoint?: string; files?: ProjectFile[]; edits?: ProjectEdit[] };
  result: string;
  sources?: Source[];
};
export type AgentToolRequest = {
  tool: 'edit_project';
  callId: string;
  thoughtSignature: string;
  arguments: { entrypoint: string; edits: ProjectEdit[] };
  history: AgentToolExchange[];
  candidates?: AgentToolCandidate[];
} | {
  tool: 'run_code';
  callId: string;
  thoughtSignature: string;
  arguments: { language: RunLanguage; code: string };
  history: AgentToolExchange[];
  candidates?: AgentToolCandidate[];
} | {
  tool: 'write_project';
  callId: string;
  thoughtSignature: string;
  arguments: { entrypoint: string; files: ProjectFile[] };
  history: AgentToolExchange[];
  candidates?: AgentToolCandidate[];
};
export type AgentToolCandidate = {
  model: string;
  tool: 'edit_project';
  callId: string;
  thoughtSignature: string;
  arguments: { entrypoint: string; edits: ProjectEdit[] };
} | {
  model: string;
  tool: 'run_code';
  callId: string;
  thoughtSignature: string;
  arguments: { language: RunLanguage; code: string };
} | {
  model: string;
  tool: 'write_project';
  callId: string;
  thoughtSignature: string;
  arguments: { entrypoint: string; files: ProjectFile[] };
};
export type AgentRetryRequest = { afterMs: number; history: AgentToolExchange[] };
export type StreamEvent = { content?: string; reasoning?: string; done?: boolean; error?: string; activity?: Activity; sources?: Source[]; notice?: Notice; model?: string; agentProvider?: 'gemini' | 'groq'; agentTask?: AgentTask; agentTool?: AgentToolRequest; agentRetry?: AgentRetryRequest };

export function isAgentHistory(history: unknown): history is AgentToolExchange[] {
  return Array.isArray(history) && history.length <= 6 && history.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const exchange = entry as Record<string, unknown>;
    const common = (exchange.tool === 'web_search' || exchange.tool === 'run_code' || exchange.tool === 'write_project' || exchange.tool === 'edit_project')
      && typeof exchange.callId === 'string' && Boolean(exchange.callId) && exchange.callId.length <= 128
      && typeof exchange.thoughtSignature === 'string' && Boolean(exchange.thoughtSignature) && exchange.thoughtSignature.length <= 4096
      && exchange.arguments !== null && typeof exchange.arguments === 'object' && !Array.isArray(exchange.arguments)
      && typeof exchange.result === 'string' && exchange.result.length <= 8_000;
    if (!common) return false;
    const args = exchange.arguments as Record<string, unknown>;
    if (exchange.tool === 'run_code') {
      return ['python', 'javascript', 'html'].includes(String(args.language)) &&
        typeof args.code === 'string' && Boolean(args.code.trim()) && args.code.length <= 20_000;
    }
    if (exchange.tool === 'web_search') return typeof args.query === 'string' && args.query.trim().length >= 2 && args.query.length <= 300;
    try {
      if (exchange.tool === 'edit_project') {
        validateProjectEdits(args.edits);
        return typeof args.entrypoint === 'string' && !!args.entrypoint && args.entrypoint.length <= 160;
      }
      const files = validateProjectFiles(args.files);
      return typeof args.entrypoint === 'string' && files.some(file => file.path === args.entrypoint);
    } catch { return false; }
  });
}

function isAgentToolRequest(value: unknown): value is AgentToolRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const tool = value as Record<string, unknown>;
  if ((tool.tool !== 'run_code' && tool.tool !== 'write_project' && tool.tool !== 'edit_project') ||
      typeof tool.callId !== 'string' || !tool.callId || tool.callId.length > 128 ||
      typeof tool.thoughtSignature !== 'string' || !tool.thoughtSignature || tool.thoughtSignature.length > 4096 ||
      !tool.arguments || typeof tool.arguments !== 'object' || Array.isArray(tool.arguments) ||
      !Array.isArray(tool.history) || tool.history.length > 6) return false;
  if (tool.candidates !== undefined &&
      (!Array.isArray(tool.candidates) || tool.candidates.length !== 2 ||
       !tool.candidates.every((candidate) => isAgentToolCandidate(candidate)))) return false;
  const args = tool.arguments as Record<string, unknown>;
  if (tool.tool === 'run_code') {
    if (!['python', 'javascript', 'html'].includes(String(args.language)) ||
        typeof args.code !== 'string' || !args.code.trim() || args.code.length > 20_000) return false;
  } else if (tool.tool === 'edit_project') {
    try { validateProjectEdits(args.edits); } catch { return false; }
    if (typeof args.entrypoint !== 'string' || !args.entrypoint || args.entrypoint.length > 160) return false;
  } else {
    try {
      const files = validateProjectFiles(args.files);
      if (typeof args.entrypoint !== 'string' || !files.some((file) => file.path === args.entrypoint)) return false;
    } catch {
      return false;
    }
  }
  return isAgentHistory(tool.history);
}

function isAgentToolCandidate(value: unknown): value is AgentToolCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.model === 'string' && Boolean(candidate.model) && candidate.model.length <= 128 &&
    isAgentToolRequest({
      ...candidate,
      history: [],
    });
}

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
      if (event.agentProvider !== undefined && event.agentProvider !== 'gemini' && event.agentProvider !== 'groq') {
        throw new Error('The server sent an invalid Agent provider.');
      }
      if (event.agentTask !== undefined && !['coding', 'planning', 'reasoning', 'fast_worker', 'document', 'synthesis', 'classification', 'multimodal'].includes(event.agentTask)) {
        throw new Error('The server sent an invalid Agent task route.');
      }
      if (event.activity !== undefined) {
        const activity = event.activity as unknown as Record<string, unknown>;
        if (!activity || typeof activity !== 'object' ||
            (activity.kind !== undefined && !['search', 'thinking', 'info', 'code', 'security'].includes(String(activity.kind))) ||
            (activity.status !== undefined && !['running', 'complete', 'error'].includes(String(activity.status)))) {
          throw new Error('The server sent invalid Agent activity.');
        }
      }
      if (event.done !== undefined && typeof event.done !== 'boolean') throw new Error('The server sent an invalid response event.');
      if (event.agentTool !== undefined && !isAgentToolRequest(event.agentTool)) {
        throw new Error('The server sent an invalid Agent code request.');
      }
      if (event.agentRetry !== undefined) {
        const retry = event.agentRetry;
        if (!retry || typeof retry !== 'object' ||
            !Number.isInteger(retry.afterMs) || retry.afterMs < 250 || retry.afterMs > 60_250 ||
            !isAgentHistory(retry.history) || event.agentTool !== undefined) {
          throw new Error('The server returned an invalid Agent retry request.');
        }
      }
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
