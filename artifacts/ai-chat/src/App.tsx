import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, ArrowUp, Brain, LoaderCircle, Menu, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import logoUrl from '@assets/Screenshot_2025-08-18_173849_1793633613340.png';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};
type StreamEvent = { content?: string; done?: boolean; error?: string };

const STORAGE_KEY = 'still-chat-conversations-v1';
const DEEPTHINK_KEY = 'nexo-deepthink';
const CONTEXT_LIMIT = 20;
const queryClient = new QueryClient();

const suggestions = [
  { label: 'Make a plan', text: 'Help me make a realistic plan for a calmer, more focused week.' },
  { label: 'Understand something', text: 'Explain compound interest in plain language, with a simple example.' },
  { label: 'Find the words', text: 'Help me write a thoughtful note to someone I have not checked in with.' },
  { label: 'Think it through', text: 'I have a decision to make. Help me sort through the trade-offs.' },
];

function readConversations(): Conversation[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Conversation =>
      item && typeof item.id === 'string' &&
      typeof item.title === 'string' &&
      Array.isArray(item.messages) &&
      typeof item.updatedAt === 'number'
    ).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function titleFromPrompt(prompt: string) {
  const title = prompt.replace(/\s+/g, ' ').trim();
  return title.length > 42 ? `${title.slice(0, 39).trimEnd()}…` : title;
}

function formatEvent(block: string): StreamEvent | null {
  const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
  if (!data || data === '[DONE]') return data === '[DONE]' ? { done: true } : null;
  try {
    return JSON.parse(data) as StreamEvent;
  } catch {
    return null;
  }
}

function Home() {
  const [conversations, setConversations] = useState<Conversation[]>(readConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [deepthink, setDeepthink] = useState<boolean>(() => { try { return window.localStorage.getItem(DEEPTHINK_KEY) === '1'; } catch { return false; } });
  useEffect(() => { try { window.localStorage.setItem(DEEPTHINK_KEY, deepthink ? '1' : '0'); } catch { /* ignore */ } }, [deepthink]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeStreamId = useRef<string | null>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const currentMessages = activeConversation?.messages ?? [];

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      } catch {
        setError('Your browser could not save this conversation. Check available storage and try again.');
      }
    }
  }, [conversations, hydrated]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [currentMessages.length, currentMessages[currentMessages.length - 1]?.content]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const updateConversation = useCallback((id: string, updater: (conversation: Conversation) => Conversation) => {
    setConversations((items) => items.map((conversation) => conversation.id === id ? updater(conversation) : conversation));
  }, []);

  const removePendingAssistant = useCallback((id: string | null) => {
    if (!id) return;
    updateConversation(id, (item) => ({
      ...item,
      messages: item.messages.filter((message, index) =>
        !(index === item.messages.length - 1 && message.role === 'assistant' && !message.content)
      ),
    }));
  }, [updateConversation]);

  const createConversation = useCallback(() => {
    removePendingAssistant(activeStreamId.current);
    abortRef.current?.abort();
    abortRef.current = null;
    activeStreamId.current = null;
    setStreaming(false);
    setError('');
    setDraft('');
    const conversation: Conversation = {
      id: makeId(),
      title: 'New conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((items) => [conversation, ...items]);
    setActiveId(conversation.id);
    setSidebarOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [removePendingAssistant]);

  const selectConversation = (id: string) => {
    setActiveId(id);
    setError('');
    setSidebarOpen(false);
  };

  const deleteConversation = (conversation: Conversation) => {
    const confirmed = window.confirm(`Delete “${conversation.title}”? This cannot be undone.`);
    if (!confirmed) return;
    setConversations((items) => items.filter((item) => item.id !== conversation.id));
    if (activeId === conversation.id) {
      abortRef.current?.abort();
      abortRef.current = null;
      activeStreamId.current = null;
      setStreaming(false);
      setActiveId(null);
      setError('');
    }
  };

  const stopResponse = () => {
    removePendingAssistant(activeStreamId.current);
    abortRef.current?.abort();
    abortRef.current = null;
    activeStreamId.current = null;
    setStreaming(false);
  };

  const sendMessage = async (event?: FormEvent, suggestedText?: string) => {
    event?.preventDefault();
    if (streaming) return;
    const prompt = (suggestedText ?? draft).trim();
    if (!prompt) return;

    let conversation = activeConversation;
    if (!conversation) {
      conversation = {
        id: makeId(),
        title: titleFromPrompt(prompt),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConversations((items) => [conversation as Conversation, ...items]);
      setActiveId(conversation.id);
    }

    const conversationId = conversation.id;
    const userMessage: ChatMessage = { role: 'user', content: prompt };
    const fullMessages = [...conversation.messages.filter((m) => m.content.trim()), userMessage];
    const requestMessages = fullMessages.slice(-CONTEXT_LIMIT).map((message) => ({
      ...message,
      content: message.content.slice(0, 12000),
    }));
    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    setConversations((items) => {
      const exists = items.some((item) => item.id === conversationId);
      const updated: Conversation = {
        ...(exists ? items.find((item) => item.id === conversationId)! : conversation!),
        title: conversation!.messages.length === 0 ? titleFromPrompt(prompt) : conversation!.title,
        messages: [...fullMessages, assistantMessage],
        updatedAt: Date.now(),
      };
      return [updated, ...items.filter((item) => item.id !== conversationId)];
    });
    setDraft('');
    setError('');
    setStreaming(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const controller = new AbortController();
    abortRef.current = controller;
    activeStreamId.current = conversationId;
    let received = '';
    try {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        credentials: 'include',
        body: JSON.stringify({ messages: requestMessages, deepthink }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let message = `The request could not be completed (${response.status}).`;
        try {
          const body = await response.json() as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // Keep the useful HTTP status when the server response is not JSON.
        }
        throw new Error(message);
      }
      if (!response.body) throw new Error('This browser could not open the response stream. Please try again.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let doneEvent = false;
      const acceptEvent = (block: string) => {
        const eventData = formatEvent(block);
        if (!eventData) return;
        if (eventData.error) throw new Error(eventData.error);
        if (typeof eventData.content === 'string') {
          received += eventData.content;
          updateConversation(conversationId, (item) => ({
            ...item,
            messages: item.messages.map((message, index) =>
              index === item.messages.length - 1 && message.role === 'assistant'
                ? { ...message, content: received }
                : message
            ),
            updatedAt: Date.now(),
          }));
        }
        if (eventData.done) doneEvent = true;
      };

      while (!doneEvent) {
        const { value, done } = await reader.read();
        if (done) {
          pending += decoder.decode();
          break;
        }
        pending += decoder.decode(value, { stream: true });
        const blocks = pending.split(/\r?\n\r?\n/);
        pending = blocks.pop() ?? '';
        blocks.forEach(acceptEvent);
      }
      if (pending.trim()) acceptEvent(pending);
      if (!doneEvent) {
        throw new Error(received ? 'The connection closed before the response finished. The partial answer is kept above.' : 'The connection closed before any response arrived. Please try again.');
      }
      if (!received.trim()) {
        setError('Nexo AI returned an empty response. Try rephrasing or sending again.');
        updateConversation(conversationId, (item) => ({
          ...item,
          messages: item.messages.filter((message, index) =>
            !(index === item.messages.length - 1 && message.role === 'assistant' && !message.content)
          ),
          updatedAt: Date.now(),
        }));
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      if (requestError instanceof Error && requestError.name === 'AbortError') return;
      setError(requestError instanceof Error ? requestError.message : 'Something went wrong. Please try again.');
      if (!received) {
        updateConversation(conversationId, (item) => ({
          ...item,
          messages: item.messages.filter((message, index) =>
            !(index === item.messages.length - 1 && message.role === 'assistant' && !message.content)
          ),
          updatedAt: Date.now(),
        }));
      }
    } finally {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        activeStreamId.current = null;
        setStreaming(false);
      }
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="Conversation history">
        <div className="brand">
          <img className="brand-mark" src={logoUrl} alt="Nexo AI logo" data-testid="img-logo" />
          <div>
            <div className="brand-name">Nexo AI</div>
            <div className="brand-note">GPT-OSS 120B on Groq</div>
          </div>
        </div>
        <button className="new-chat" type="button" onClick={createConversation} data-testid="button-new-chat">
          <Plus size={16} /> New conversation
        </button>
        <div className="section-label">Your conversations</div>
        <div className="thread-list" role="list" aria-label="Saved conversations" data-testid="list-conversations">
          {conversations.length === 0 ? (
            <div className="thread-empty" data-testid="empty-conversations">No conversations yet.</div>
          ) : conversations.map((conversation) => (
            <div className="thread-item" role="listitem" key={conversation.id} data-testid={`conversation-${conversation.id}`}>
              <button
                type="button"
                className={`thread-select ${conversation.id === activeId ? 'is-active' : ''}`}
                onClick={() => selectConversation(conversation.id)}
                aria-current={conversation.id === activeId ? 'page' : undefined}
                title={conversation.title}
                data-testid={`select-conversation-${conversation.id}`}
              >
                <MessageSquare className="thread-icon" size={14} />
                <span className="thread-title">{conversation.title}</span>
              </button>
              <button
                className="thread-delete"
                type="button"
                aria-label={`Delete ${conversation.title}`}
                title="Delete conversation"
                onClick={() => deleteConversation(conversation)}
                data-testid={`delete-conversation-${conversation.id}`}
              ><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="sidebar-foot"><span className="status-dot" aria-hidden="true" /> Private to this browser</div>
      </aside>
      <button
        className={`scrim ${sidebarOpen ? 'is-visible' : ''}`}
        type="button"
        aria-label="Close conversation menu"
        onClick={() => setSidebarOpen(false)}
        tabIndex={sidebarOpen ? 0 : -1}
        data-testid="button-close-menu-overlay"
      />
      <main className="main-pane">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open conversation menu" data-testid="button-open-menu">
              <Menu size={19} />
            </button>
            <div className="context-title" title={activeConversation?.title ?? 'New conversation'}>
              {activeConversation?.title ?? 'New conversation'}
            </div>
          </div>
          <div className={`mode-pill ${deepthink ? 'is-deep' : ''}`} data-testid="status-mode"><span className="mode-dot" aria-hidden="true" />{deepthink ? 'Deepthink · high reasoning' : 'Standard · medium reasoning'}</div>
        </header>

        <section className="chat-region" aria-label="AI conversation">
          <div className="messages" aria-live="polite" aria-relevant="additions text" data-testid="chat-messages">
            {currentMessages.length === 0 ? (
              <div className="welcome" data-testid="welcome-screen">
                <img className="welcome-logo" src={logoUrl} alt="" aria-hidden="true" />
                <div className="welcome-kicker">Nexo AI</div>
                <h1>Ask anything.<br /><em>Go deeper</em> when it matters.</h1>
                <p>Everyday questions get quick answers. Turn on Deepthink for harder problems that need more reasoning.</p>
                <div className="suggestions" aria-label="Ideas to get started">
                  {suggestions.map((suggestion) => (
                    <button
                      className="suggestion"
                      type="button"
                      key={suggestion.label}
                      onClick={() => void sendMessage(undefined, suggestion.text)}
                      disabled={streaming}
                      data-testid={`suggestion-${suggestion.label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <span className="suggestion-label">{suggestion.label}</span>
                      <span className="suggestion-text">{suggestion.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="conversation-flow" data-testid={`active-conversation-${activeConversation?.id ?? 'none'}`}>
                {currentMessages.map((message, index) => {
                  const isPending = streaming && message.role === 'assistant' && index === currentMessages.length - 1 && !message.content;
                  return (
                    <article className={`message-row ${message.role}`} key={`${activeConversation?.id}-${index}`} data-testid={`message-${message.role}-${index}`}>
                      <div className={`avatar ${message.role === 'user' ? 'user-avatar' : ''}`} aria-hidden="true">
                        {message.role === 'assistant' ? <img src={logoUrl} alt="" /> : <span>Y</span>}
                      </div>
                      <div className="message-content">
                        <div className="message-role">{message.role === 'assistant' ? 'Nexo AI' : 'You'}</div>
                        <div className={`message-text ${message.role === 'assistant' ? 'markdown' : ''}`} data-testid={`message-content-${index}`}>
                          {isPending ? <span className="thinking"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> {deepthink ? 'Thinking deeply' : 'Thinking'}</span> : message.role === 'assistant' ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />, table: ({ node: _n, ...props }) => <div className="table-wrap"><table {...props} /></div> }}>{message.content}</ReactMarkdown>
                          ) : message.content}
                          {streaming && message.role === 'assistant' && index === currentMessages.length - 1 && message.content && <span className="typing-caret" aria-hidden="true" />}
                        </div>
                      </div>
                    </article>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {error && (
            <div className="request-error" role="alert" data-testid="status-request-error">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
              <button type="button" aria-label="Dismiss error" onClick={() => setError('')} data-testid="button-dismiss-error"><X size={14} /></button>
            </div>
          )}

          <div>
            <form className="composer-wrap" onSubmit={(event) => void sendMessage(event)} aria-label="Send a message">
              <div className="composer">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                  placeholder={deepthink ? 'Describe a hard problem…' : 'Ask Nexo AI anything…'}
                  aria-label="Your message"
                  maxLength={12000}
                  disabled={streaming}
                  data-testid="input-message"
                />
                {streaming ? (
                  <button className="send-button stop" type="button" onClick={stopResponse} aria-label="Stop response" title="Stop response" data-testid="button-stop-response">
                    <X size={17} />
                  </button>
                ) : (
                  <button className="send-button" type="submit" disabled={!draft.trim()} aria-label="Send message" title="Send message" data-testid="button-send-message">
                    <ArrowUp size={18} />
                  </button>
                )}
              </div>
              <div className="composer-hint">
                <button type="button" role="switch" aria-checked={deepthink} aria-label="Deepthink (high reasoning)" className={`deep-toggle ${deepthink ? 'is-on' : ''}`} disabled={streaming} title={streaming ? 'Mode cannot change while a response is streaming' : undefined} onClick={() => setDeepthink((v) => !v)} data-testid="toggle-deepthink">
                  <Brain size={13} aria-hidden="true" /><span>Deepthink</span><span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span><span className="deep-state">{deepthink ? 'High' : 'Medium'}</span>
                </button>
                <span className="hint-keys">Enter to send · Shift + Enter for new line</span>
              </div>
            </form>
          <p className="privacy-note">Powered by GPT-OSS 120B on Groq. Conversations are saved only in this browser.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
