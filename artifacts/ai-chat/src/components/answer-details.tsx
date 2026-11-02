import { useEffect, useState } from 'react';
import { AlertTriangle, Brain, ChevronDown, ExternalLink } from 'lucide-react';

export type Activity = { id: string; label: string; kind?: 'search' | 'thinking' | 'info'; status?: 'running' | 'complete' | 'error' };
export type Source = { title: string; url: string };
export type Notice = { id: string; message: string; model?: string };
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  activity?: Activity[];
  sources?: Source[];
  notices?: Notice[];
  model?: string;
};

export function BrainThinking({ deep }: { deep: boolean }) {
  return (
    <span className={`brain-think ${deep ? 'is-deep' : ''}`} role="status" data-testid="status-thinking">
      <span className="brain-orb" aria-hidden="true"><Brain size={15} /><span className="brain-ring" /><span className="brain-ring r2" /></span>
      <span className="brain-label">{deep ? 'Deepthink is working' : 'Working on it'}<span className="brain-dots" aria-hidden="true"><i /><i /><i /></span></span>
    </span>
  );
}

export function SearchGlobe({ size = 34 }: { size?: number }) {
  return (
    <span className="search-globe" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 40 40" className="globe-svg">
        <circle cx="20" cy="20" r="13" className="globe-body" />
        <g className="globe-lines">
          <ellipse cx="20" cy="20" rx="6" ry="13" />
          <ellipse cx="20" cy="20" rx="11" ry="13" />
        </g>
        <line x1="7" y1="20" x2="33" y2="20" className="globe-eq" />
        <path d="M9 14 H31 M9 26 H31" className="globe-eq" />
      </svg>
      <span className="glass-orbit"><svg viewBox="0 0 20 20" className="glass"><circle cx="8" cy="8" r="5" /><line x1="12" y1="12" x2="17" y2="17" /></svg></span>
    </span>
  );
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

const mark = (a: Activity, live: boolean) => {
  const s = a.status ?? (live ? 'running' : 'complete');
  return s === 'running' ? (live ? 'run' : 'stop') : s === 'error' ? 'err' : ' ok';
};

export function ThinkingPanel({ message, live, index }: { message: ChatMessage; live: boolean; index: number }) {
  const activity = (message.activity ?? []).filter((a) => a.id !== 'clock' && !/^Current (?:date|data) and time included$/i.test(a.label));
  const sources = message.sources ?? [];
  const reasoning = message.reasoning ?? '';
  const [open, setOpen] = useState(live);
  useEffect(() => { if (live) setOpen(true); }, [live]);
  if (!live && activity.length === 0 && sources.length === 0 && !reasoning) return null;
  const searching = live && activity.some((a) => a.kind === 'search' && a.status === 'running');
  const runningLabel = live ? [...activity].reverse().find((a) => a.status === 'running')?.label : undefined;
  const bodyId = `progress-body-${index}`;
  return (
    <div className={`term ${live ? 'is-live' : ''}`} data-testid={`panel-progress-${index}`}>
      <button type="button" className="term-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)} data-testid={`toggle-progress-${index}`}>
        <span className="term-prompt">&gt;&gt;&gt;</span>
        <span className="term-title">{live ? (searching ? 'Searching the web' : 'Thinking') : 'Thinking'}{live && <span className="term-ellipsis" aria-hidden="true" />}</span>
        <span className="term-meta">{activity.length} step{activity.length === 1 ? '' : 's'}{sources.length ? ` / ${sources.length} source${sources.length === 1 ? '' : 's'}` : ''}</span>
        <ChevronDown size={13} className={`term-chev ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      {searching && (
        <div className="term-search" role="status" data-testid={`status-searching-${index}`}>
          <SearchGlobe />
          <span>{runningLabel ?? 'Looking around the web'}</span>
        </div>
      )}
      {open && (
        <div className="term-body" id={bodyId}>
          {reasoning ? (
            <>
              <p className="term-note"># model reasoning — full trace returned by the provider</p>
              <pre className="term-reasoning" data-testid={`reasoning-${index}`}>{reasoning}</pre>
            </>
          ) : (
            <p className="term-note">{live ? '# waiting for model reasoning…' : '# no provider reasoning trace was recorded for this response'}</p>
          )}
          {activity.length === 0 ? (
            <p className="term-line dim">{live ? 'waiting for server activity...' : 'no activity recorded.'}</p>
          ) : activity.map((a) => (
            <p key={a.id} className={`term-line st-${a.status ?? 'complete'} k-${a.kind ?? 'info'}`} data-testid={`activity-${index}-${a.id}`}>
              <span className="term-tag">[{mark(a, live)}]</span> {a.label}
            </p>
          ))}
          {sources.length > 0 && (
            <div className="term-sources">
              <p className="term-line dim"># sources</p>
              {sources.map((src) => (
                <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer nofollow" data-testid={`link-source-${index}`}>
                  <ExternalLink size={11} aria-hidden="true" /><span>{src.title || src.url}</span>
                </a>
              ))}
            </div>
          )}
          {!live && <p className="term-line dim">...done.</p>}
        </div>
      )}
    </div>
  );
}

export const AnswerActivity = ThinkingPanel;
