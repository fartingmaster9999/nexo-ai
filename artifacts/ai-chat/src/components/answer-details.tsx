import { useState } from 'react';
import { AlertTriangle, Brain, ChevronDown } from 'lucide-react';
import { splitReasoning } from '../lib/reasoning-sections';

export type Activity = { id: string; label: string; kind?: 'search' | 'thinking' | 'info'; status?: 'running' | 'complete' | 'error' };
export type Source = { title: string; url: string };
export type Notice = { id: string; message: string; model?: string };
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  deepthink?: boolean;
  activity?: Activity[];
  sources?: Source[];
  notices?: Notice[];
  model?: string;
};

export type ReplyMode = 'search' | 'deep' | 'normal';

export function isSearching(message: ChatMessage, live: boolean) {
  return live && (message.activity ?? []).some((a) => a.kind === 'search' && a.status === 'running');
}

function SearchFigure() {
  return (
    <span className="rs-fig rs-search" aria-hidden="true">
      <span className="rs-stage">
        <span className="rs-globe"><i className="g-mer m1" /><i className="g-mer m2" /><i className="g-lat" /></span>
        <span className="rs-orbit"><span className="rs-glass"><i className="lens" /><i className="handle" /></span></span>
      </span>
    </span>
  );
}

function BrainFigure() {
  return (
    <span className="rs-fig rs-brain" aria-hidden="true">
      <span className="rs-stage">
        <span className="rs-layer l1" /><span className="rs-layer l2" />
        <span className="rs-brain-icon"><Brain size={16} /></span>
      </span>
    </span>
  );
}

function NormalFigure() {
  return (
    <span className="rs-fig rs-normal" aria-hidden="true">
      <span className="rs-stage">
        <i className="rs-plane p1" /><i className="rs-plane p2" /><i className="rs-plane p3" />
      </span>
    </span>
  );
}

/** Single status indicator: search takes precedence, then deepthink, then normal. */
export function ReplyStatus({ mode, label, compact = false }: { mode: ReplyMode; label?: string; compact?: boolean }) {
  const text = label ?? (mode === 'search' ? 'Searching the web' : mode === 'deep' ? 'Deepthink is working' : 'Working on it');
  return (
    <span className={`reply-status rs-${mode}-mode${compact ? ' is-compact' : ''}`} role="status" aria-label={text} data-mode={mode} data-testid={mode === 'search' ? 'status-searching' : 'status-thinking'}>
      {mode === 'search' ? <SearchFigure /> : mode === 'deep' ? <BrainFigure /> : <NormalFigure />}
      {!compact && <span className="rs-label">{text}</span>}
    </span>
  );
}

/** Backwards-compatible wrapper. */
export function BrainThinking({ deep }: { deep: boolean }) {
  return <ReplyStatus mode={deep ? 'deep' : 'normal'} />;
}

export function NoticeBanner({ notices, index }: { notices?: Notice[]; index: number }) {
  if (!notices?.length) return null;
  return (
    <>
      {notices.map((n) => (
        <div key={n.id} className="notice-banner" role="status" data-testid={`notice-${index}-${n.id}`}>
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{n.message}{n.model ? <> <b className="notice-model">{n.model}</b></> : null}</span>
        </div>
      ))}
    </>
  );
}

export function ThinkingPanel({ message, live, index }: { message: ChatMessage; live: boolean; index: number }) {
  const reasoning = message.reasoning ?? '';
  const [open, setOpen] = useState(false);
  const searching = isSearching(message, live);
  const hasActivity = (message.activity ?? []).length > 0;
  if (!live && !reasoning && !hasActivity) return null;
  const runningLabel = searching ? [...(message.activity ?? [])].reverse().find((a) => a.kind === 'search' && a.status === 'running')?.label : undefined;
  const bodyId = `progress-body-${index}`;
  const sections = splitReasoning(reasoning);
  return (
    <div className={`term ${live ? 'is-live' : ''}`} data-testid={`panel-progress-${index}`}>
      <button type="button" className="term-head" aria-expanded={open} aria-controls={open ? bodyId : undefined} aria-label={`${open ? 'Hide' : 'Show'} model reasoning`} onClick={() => setOpen((v) => !v)} data-testid={`toggle-progress-${index}`}>
        <span className="term-prompt" aria-hidden="true">&gt;&gt;&gt;</span>
        <span className="term-title">{live ? 'Thinking' : 'Thought process'}{live && <span className="term-ellipsis" aria-hidden="true" />}</span>
        <ChevronDown size={13} className={`term-chev ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      {searching && (
        <div className="term-search" data-testid={`status-searching-${index}`}>
          <ReplyStatus mode="search" label={runningLabel ?? 'Searching the web'} />
        </div>
      )}
      {open && (
        <div className="term-body" id={bodyId}>
          {reasoning ? (
            <div className="reason-flow" data-testid={`reasoning-${index}`}>
              {sections.map((sec, i) => (
                <p key={i} className="reason-sec"><span className="reason-idx" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><span className="reason-txt">{sec}</span></p>
              ))}
            </div>
          ) : (
            <p className="term-note">{live ? 'Waiting for model reasoning…' : 'No reasoning trace was returned for this response.'}</p>
          )}
        </div>
      )}
    </div>
  );
}

export const AnswerActivity = ThinkingPanel;
