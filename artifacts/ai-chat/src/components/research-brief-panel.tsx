import { useState } from 'react';
import { Check, Copy, ExternalLink, Search, X } from 'lucide-react';
import { MessageMarkdown } from './message-markdown';
import type { Source } from './answer-details';
import './research-brief-panel.css';

type ResearchBriefPanelProps = {
  content: string;
  sources: Source[];
  isStreaming: boolean;
  isSearching: boolean;
  failed: boolean;
  conversationId: string;
  messageId: string;
  onClose: () => void;
};

function sourceHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./i, ''); }
  catch { return url; }
}

function safeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function ResearchBriefPanel({
  content, sources, isStreaming, isSearching, failed, conversationId, messageId, onClose,
}: ResearchBriefPanelProps) {
  const [copied, setCopied] = useState(false);
  const safeSources = sources.flatMap((source) => {
    const url = safeSourceUrl(source.url);
    return url ? [{ ...source, url }] : [];
  });
  const stateLabel = isSearching ? 'Finding sources' : isStreaming ? 'Writing brief' : 'Research brief';
  const copyBrief = async () => {
    if (!content || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="research-brief-panel" aria-label="Research brief" data-testid="panel-research-brief">
      <header className="research-brief-header">
        <span className="research-brief-icon" aria-hidden="true"><Search size={17} /></span>
        <div className="research-brief-heading">
          <h2>Research brief</h2>
          <span className={isStreaming ? 'is-active' : ''} role="status" aria-live="polite" data-testid="status-research-brief">
            <i aria-hidden="true" />{stateLabel}
          </span>
        </div>
        <div className="research-brief-actions">
          <button type="button" className="research-icon-button" onClick={() => void copyBrief()} disabled={!content}
            aria-label={copied ? 'Brief copied' : 'Copy research brief'} title={copied ? 'Copied' : 'Copy brief'} data-testid="button-copy-research-brief">
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          </button>
          <button type="button" className="research-icon-button" onClick={onClose}
            aria-label="Close research brief" title="Return to chat" data-testid="button-close-research-brief">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="research-brief-scroll">
        {failed && (
          <div className="research-brief-warning" role="status">
            Web search did not return verifiable sources. Treat changing facts as unverified.
          </div>
        )}
        {content ? (
          <article className="research-brief-prose" data-testid="research-brief-content">
            <MessageMarkdown content={content} live={isStreaming} conversationId={conversationId} messageId={messageId} sources={safeSources} />
          </article>
        ) : (
          <div className="research-brief-loading" role="status" data-testid="research-brief-loading">
            <span className="research-loading-mark"><Search size={20} aria-hidden="true" /></span>
            <strong>{isSearching ? 'Gathering public sources' : 'Preparing your research'}</strong>
            <p>Nexo will organize the findings and link the sources used.</p>
          </div>
        )}

        <section className="research-sources" aria-labelledby="research-sources-title">
          <div className="research-sources-heading">
            <h3 id="research-sources-title">Sources</h3>
            <span>{safeSources.length}</span>
          </div>
          {safeSources.length ? (
            <ol>
              {safeSources.map((source, index) => (
                <li key={`${source.url}-${index}`}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">
                    <span className="research-source-copy">
                      <strong>{source.title.trim() || sourceHost(source.url)}</strong>
                      <small>{sourceHost(source.url)}</small>
                    </span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="research-sources-empty">{isStreaming ? 'Sources will appear here as they are collected.' : 'No source links were returned for this brief.'}</p>
          )}
        </section>
      </div>
    </aside>
  );
}
