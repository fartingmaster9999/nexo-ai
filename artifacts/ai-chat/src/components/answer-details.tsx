import { Brain, ChevronDown, ExternalLink } from 'lucide-react';

export type Activity = { id: string; label: string };
export type Source = { title: string; url: string };
export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  activity?: Activity[];
  sources?: Source[];
};

export function BrainThinking({ deep }: { deep: boolean }) {
  return (
    <span className={`brain-think ${deep ? 'is-deep' : ''}`} role="status" data-testid="status-thinking">
      <span className="brain-orb" aria-hidden="true"><Brain size={15} /><span className="brain-ring" /><span className="brain-ring r2" /></span>
      <span className="brain-label">{deep ? 'Deepthink is working' : 'Working on it'}<span className="brain-dots" aria-hidden="true"><i /><i /><i /></span></span>
    </span>
  );
}

export function AnswerActivity({ message, live, index }: { message: ChatMessage; live: boolean; index: number }) {
  const activity = message.activity ?? [];
  const sources = message.sources ?? [];
  if (!live && activity.length === 0 && sources.length === 0) return null;
  return (
    <details className="activity" data-testid={`details-activity-${index}`}>
      <summary data-testid={`toggle-activity-${index}`}>
        <span className={`activity-pip ${live ? 'is-live' : ''}`} aria-hidden="true" />
        Answer activity
        <span className="activity-count">{activity.length} step{activity.length === 1 ? '' : 's'}{sources.length ? ` · ${sources.length} source${sources.length === 1 ? '' : 's'}` : ''}</span>
        <ChevronDown size={13} className="activity-chev" aria-hidden="true" />
      </summary>
      <div className="activity-body">
        <p className="activity-note">Activity and sources, not private internal reasoning.</p>
        {activity.length > 0 ? (
          <ol className="activity-list">
            {activity.map((a) => <li key={a.id} data-testid={`activity-${index}-${a.id}`}>{a.label}</li>)}
          </ol>
        ) : <p className="activity-empty">{live ? 'Waiting for server activity…' : 'No activity recorded.'}</p>}
        {sources.length > 0 && (
          <div className="activity-sources">
            <div className="activity-head">Sources</div>
            {sources.map((src) => (
              <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer nofollow" data-testid={`link-source-${index}`}>
                <ExternalLink size={11} aria-hidden="true" /><span>{src.title || src.url}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
