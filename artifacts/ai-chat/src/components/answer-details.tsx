import { memo, useState } from 'react';
import { AlertTriangle, Bot, Brain, ChevronDown, Info, PanelRightOpen } from 'lucide-react';
import './thinking-motion.css';
import { splitReasoning } from '../lib/reasoning-sections';
import type { QuizProgress } from '../lib/interactive-widgets';

export type Activity = { id: string; label: string; kind?: 'search' | 'thinking' | 'info' | 'code' | 'security'; status?: 'running' | 'complete' | 'error' };
export type AgentTask = 'coding' | 'planning' | 'reasoning' | 'fast_worker' | 'document' | 'synthesis' | 'classification' | 'multimodal';
export type Source = { title: string; url: string; retrieval?: 'page' | 'search_excerpt'; retrievedAt?: string };
export type Notice = { id: string; message: string; model?: string };
export type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  imageAttached?: boolean;
  reasoning?: string;
  deepthink?: boolean;
  agentMode?: boolean;
  activity?: Activity[];
  sources?: Source[];
  notices?: Notice[];
  model?: string;
  agentTask?: AgentTask;
  quizProgress?: Record<string, QuizProgress>;
};

export type ReplyMode = 'search' | 'deep' | 'agent' | 'normal';

export function isSearching(message: ChatMessage, live: boolean) {
  return live && (message.activity ?? []).some((a) => a.kind === 'search' && a.status === 'running');
}

function SearchFigure() {
  return (
    <span className="rs-fig rs-search" aria-hidden="true">
      <span className="rs-stage">
        <span className="rs-halo" />
        <span className="rs-globe"><i className="g-mer m1" /><i className="g-mer m2" /><i className="g-lat" /><i className="g-lat t" /><i className="g-lat b" /></span>
        <span className="rs-orbit"><span className="rs-glass"><i className="lens" /><i className="handle" /></span></span>
      </span>
    </span>
  );
}

function BrainFigure() {
  return (
    <span className="rs-fig rs-brain" aria-hidden="true">
      <span className="rs-stage">
        <span className="rs-halo" />
        <span className="rs-layer l1" /><span className="rs-layer l2" /><i className="rs-spark" /><i className="rs-node n1" /><i className="rs-node n2" /><i className="rs-node n3" />
        <span className="rs-brain-icon"><Brain size={16} /></span>
      </span>
    </span>
  );
}

function AgentFigure() {
  return (
    <span className="rs-fig rs-agent" aria-hidden="true">
      <span className="rs-stage">
        <span className="rs-halo" />
        <i className="rs-agent-ring ring-a" />
        <i className="rs-agent-ring ring-b" />
        <span className="rs-agent-core"><Bot size={15} /></span>
      </span>
    </span>
  );
}

function NormalFigure() {
  return (
    <span className="rs-fig rs-normal" aria-hidden="true">
      <span className="rs-stage">
        <span className="rs-halo" />
        <i className="rs-plane p3" /><i className="rs-plane p2" /><i className="rs-plane p1" /><i className="rs-core" />
      </span>
    </span>
  );
}

/** Single status indicator: search takes precedence, then deepthink, then normal. */
export const ReplyStatus = memo(function ReplyStatus({ mode, label, compact = false, decorative = false }: { mode: ReplyMode; label?: string; compact?: boolean; decorative?: boolean }) {
  const text = label ?? (mode === 'search' ? 'Searching the web' : mode === 'deep' ? 'Deepthink is working' : mode === 'agent' ? 'Agent is working' : 'Working on it');
  return (
    <span className={`reply-status rs-${mode}-mode${compact ? ' is-compact' : ''}`} role={decorative ? undefined : 'status'} aria-label={decorative ? undefined : text} aria-hidden={decorative || undefined} data-mode={mode} data-testid={mode === 'search' ? 'status-searching' : mode === 'agent' ? 'status-agent' : 'status-thinking'}>
      {mode === 'search' ? <SearchFigure /> : mode === 'deep' ? <BrainFigure /> : mode === 'agent' ? <AgentFigure /> : <NormalFigure />}
      {!compact && <span className="rs-label">{text}</span>}
    </span>
  );
});

/** Show the reply's thinking mode unless a live search activity owns the status. */
export function LiveReplyIndicator({ message, live, hasContent = false }: { message: ChatMessage; live: boolean; hasContent?: boolean }) {
  if (!live || isSearching(message, live) || (hasContent && !message.deepthink && !message.agentMode)) return null;
  const mode = message.deepthink ? 'deep' : message.agentMode ? 'agent' : 'normal';
  return <ReplyStatus mode={mode} compact={hasContent} />;
}

/** Backwards-compatible wrapper. */
export function BrainThinking({ deep }: { deep: boolean }) {
  return <ReplyStatus mode={deep ? 'deep' : 'normal'} />;
}

export function NoticeBanner({ notices, index }: { notices?: Notice[]; index: number }) {
  if (!notices?.length) return null;
  return (
    <>
      {notices.map((n) => {
        const fallback = n.id === 'model-downgrade' ||
          n.id === 'agent-route-fallback' ||
          n.id === 'agent-model-rate-fallback' ||
          n.id === 'agent-model-fallback' ||
          n.id === 'gemini-agent-route-fallback' ||
          n.id === 'gemini-agent-qwen-fallback' ||
          n.id === 'gemini-agent-model-fallback';
        // Normalize old saved notices too; a successful model switch is not a blocked chat.
        const text = n.id === 'model-downgrade'
          ? 'The main model could not complete this reply. A compatible model is answering—you can keep chatting.'
          : n.message;
        const Icon = fallback ? Info : AlertTriangle;
        return (
          <div key={n.id} className={`notice-banner${fallback ? ' notice-info' : ''}`} role="status" data-testid={`notice-${index}-${n.id}`}>
            <Icon size={14} aria-hidden="true" />
            <span>{text}</span>
          </div>
        );
      })}
    </>
  );
}

export const ThinkingPanel = memo(function ThinkingPanel({ message, live, index, onOpenWorkspace }: { message: ChatMessage; live: boolean; index: number; onOpenWorkspace?: () => void }) {
  const reasoning = message.reasoning ?? '';
  const [open, setOpen] = useState(false);
  const searching = isSearching(message, live);
  const agentMode = message.agentMode === true;
  const hasActivity = (message.activity ?? []).length > 0;
  const activities = message.activity ?? [];
  const runningLabel = searching ? [...activities].reverse().find((a) => a.kind === 'search' && a.status === 'running')?.label : undefined;
  const currentActivity = (live ? [...activities].reverse().find((activity) => activity.status === 'running') : undefined) ?? activities.at(-1);
  const agentProgressStatus = currentActivity?.status === 'running' && !live
    ? 'error'
    : currentActivity?.status ?? (live ? 'running' : 'complete');
  const agentProgressLabel = currentActivity?.label ?? (live ? 'Preparing the next step' : 'Agent completed the response');
  const agentProgressState = agentProgressStatus === 'running'
    ? 'In progress'
    : agentProgressStatus === 'error'
      ? currentActivity?.status === 'running' && !live ? 'Stopped early' : 'Needs attention'
      : 'Done';
  const bodyId = `progress-body-${index}`;
  const sections = open && !agentMode ? splitReasoning(reasoning) : [];
  if (!agentMode && !live && !reasoning && !hasActivity) return null;
  if (agentMode) {
    const hasWorkspaceActivity = activities.some((activity) => activity.kind === 'code') || message.agentTask === 'coding';
    return (
      <section className={`term agent-progress-panel ${live ? 'is-live' : ''}`} aria-label="Agent progress" data-testid={`panel-progress-${index}`}>
        <div className="agent-progress-heading">
          <span className="term-prompt" aria-hidden="true">&gt;&gt;&gt;</span>
          <span>Agent progress</span>
          {live && <span className="term-ellipsis" aria-hidden="true" />}
        </div>
        <div className={`agent-progress-summary status-${agentProgressStatus}`} role="status" aria-live={live ? 'polite' : 'off'} aria-atomic="true" data-testid={`agent-progress-${index}`}>
          <ReplyStatus mode={searching ? 'search' : message.deepthink ? 'deep' : 'agent'} compact decorative />
          <span className="agent-progress-label">{searching ? runningLabel : agentProgressLabel}</span>
          <small>{agentProgressState}</small>
        </div>
        <div className="agent-activity-list" role="list" aria-label="Completed and current Agent actions" data-testid={`agent-activity-${index}`}>
          {activities.length ? activities.map((activity) => {
            const status = !live && activity.status === 'running' ? 'error' : activity.status ?? 'complete';
            const state = status === 'running' ? 'In progress' : status === 'error' ? (!live && activity.status === 'running' ? 'Stopped' : 'Needs attention') : 'Done';
            return (
              <div className={`agent-activity-item status-${status}`} role="listitem" key={activity.id}>
                <span className="agent-activity-dot" aria-hidden="true" />
                <span>{activity.label}</span>
                <small>{state}</small>
              </div>
            );
          }) : (
            <p className="term-note">{live ? 'Agent is preparing the first action.' : 'No tool actions were needed for this response.'}</p>
          )}
          {message.agentTask && <span className="agent-meta-tag">Task: {message.agentTask.replaceAll('_', ' ')}</span>}
          {message.model && <span className="agent-meta-tag" data-testid={`agent-model-${index}`}>Model: {message.model}</span>}
          {hasWorkspaceActivity && onOpenWorkspace && (
            <button type="button" className="agent-open-workspace" onClick={onOpenWorkspace} aria-controls="code-workspace" data-testid={`button-agent-workspace-${index}`}>
              <PanelRightOpen size={14} aria-hidden="true" />
              <span>Open code and preview</span>
            </button>
          )}
        </div>
      </section>
    );
  }
  return (
    <div className={`term ${live ? 'is-live' : ''}`} data-testid={`panel-progress-${index}`}>
      <button type="button" className="term-head" aria-expanded={open} aria-controls={open ? bodyId : undefined} aria-label={`${open ? 'Hide' : 'Show'} ${agentMode ? 'Agent activity' : 'model reasoning'}`} onClick={() => setOpen((v) => !v)} data-testid={`toggle-progress-${index}`}>
        <span className="term-prompt" aria-hidden="true">&gt;&gt;&gt;</span>
        <span className="term-title">{message.deepthink ? (live ? 'Deepthinking' : 'Deepthink reasoning') : (live ? 'Thinking' : 'Thought process')}{live && <span className="term-ellipsis" aria-hidden="true" />}</span>
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
});

export const AnswerActivity = ThinkingPanel;
