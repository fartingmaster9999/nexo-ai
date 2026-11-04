import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertCircle, ArrowUp, ArrowUpRight, Brain, MessageSquare, PanelLeft, Plus, Settings2, Trash2, X } from 'lucide-react';
import { MessageMarkdown } from '@/components/message-markdown';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SettingsDialog } from '@/components/settings-dialog';
import { HomeLanding } from '@/components/home-landing';
import NotFound from '@/pages/not-found';
import { NoticeBanner, ThinkingPanel, ReplyStatus, isSearching, type Activity, type ChatMessage } from '@/components/answer-details';
import { consumeChatStream, type StreamEvent } from '@/lib/chat-stream';
import { useConversations } from '@/hooks/use-conversations';
import type { Conversation } from '@/lib/conversation-storage';
import { prepareRequestMessages } from '@/lib/request-context';
import { useThemeSettings } from '@/hooks/use-theme';
import { useSidebar, isMobile, SIDEBAR_MIN, SIDEBAR_MAX } from '@/hooks/use-sidebar';
import { extractSnippets } from '@/lib/code-extract';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const logoUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/nexo-logo.png`;
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const CodeWorkspace = lazy(() => import('@/components/code-workspace').then(module => ({ default: module.CodeWorkspace })));
const DEEPTHINK_KEY = 'nexo-deepthink';
const queryClient = new QueryClient();

const suggestions = [
  { label: 'Make a plan', text: 'Help me make a realistic plan for a calmer, more focused week.' },
  { label: 'Understand something', text: 'Explain compound interest in plain language, with a simple example.' },
  { label: 'Find the words', text: 'Help me write a thoughtful note to someone I have not checked in with.' },
  { label: 'Write some code', text: 'Write a Python script that plots a damped sine wave with Matplotlib.' },
];

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function titleFromPrompt(prompt: string) {
  const title = prompt.replace(/\s+/g, ' ').trim();
  return title.length > 42 ? `${title.slice(0, 39).trimEnd()}…` : title;
}

function Home() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [conversations, setConversations, persistConversations] = useConversations(setError);
  const [streaming, setStreaming] = useState(false);
  const [visibleReply, setVisibleReply] = useState<{ id: string; content: string } | null>(null);
  const sidebar = useSidebar();
  const sidebarOpen = sidebar.open;
  const setSidebarOpen = sidebar.setOpen;
  const closeIfMobile = () => { if (isMobile()) setSidebarOpen(false); };
  const theme = useThemeSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const autoOpened = useRef<string | null>(null);
  const [deepthink, setDeepthink] = useState<boolean>(() => { try { return window.localStorage.getItem(DEEPTHINK_KEY) === '1'; } catch { return false; } });
  useEffect(() => { try { window.localStorage.setItem(DEEPTHINK_KEY, deepthink ? '1' : '0'); } catch { /* ignore */ } }, [deepthink]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeStreamId = useRef<string | null>(null);
  const flushRef = useRef<(() => void) | null>(null);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;
  const currentMessages = activeConversation?.messages ?? [];
  const lastAssistantIndex = currentMessages.map((m) => m.role).lastIndexOf('assistant');
  const codeSource = (() => {
    for (let i = currentMessages.length - 1; i >= 0; i--) {
      const m = currentMessages[i];
      if (m.role === 'assistant' && m.content.includes('```')) return { index: i, text: m.content };
    }
    return null;
  })();
  const snippets = useMemo(() => codeSource ? extractSnippets(codeSource.text) : [], [codeSource?.text]);

  useEffect(() => { setWorkspaceOpen(false); }, [activeId]);
  useEffect(() => {
    if (!streaming || !activeId || !snippets.length || !codeSource || codeSource.index !== lastAssistantIndex) return;
    const key = `${activeId}:${codeSource.index}`;
    if (autoOpened.current === key) return;
    autoOpened.current = key;
    setWorkspaceOpen(true);
  }, [streaming, activeId, snippets.length, codeSource?.index, lastAssistantIndex]);

  useEffect(() => {
    const flush = () => { flushRef.current?.(); persistConversations(); };
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      abortRef.current?.abort();
      window.removeEventListener('pagehide', flush);
    };
  }, [persistConversations]);

  useEffect(() => {
    const container = messagesEndRef.current?.parentElement?.parentElement;
    if (container && container.scrollHeight - container.scrollTop - container.clientHeight < 200) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [currentMessages.length, currentMessages[currentMessages.length - 1]?.content, visibleReply?.content]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && isMobile() && !document.querySelector('[role="dialog"]')) setSidebarOpen(false);
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
        !(index === item.messages.length - 1 && message.role === 'assistant' && !message.content && !message.reasoning)
      ),
    }));
  }, [updateConversation]);

  const createConversation = useCallback(() => {
    flushRef.current?.();
    flushRef.current = null;
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
    closeIfMobile();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [removePendingAssistant]);

  const returnHome = () => {
    flushRef.current?.();
    flushRef.current = null;
    removePendingAssistant(activeStreamId.current);
    abortRef.current?.abort();
    abortRef.current = null;
    activeStreamId.current = null;
    setStreaming(false);
    setVisibleReply(null);
    setActiveId(null);
    setError('');
    closeIfMobile();
  };

  const selectConversation = (id: string) => {
    setActiveId(id);
    setError('');
    closeIfMobile();
  };

  const deleteConversation = (conversation: Conversation) => {
    const confirmed = window.confirm(`Delete “${conversation.title}”? This cannot be undone.`);
    if (!confirmed) return;
    if (activeStreamId.current === conversation.id) {
      flushRef.current?.();
      flushRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
      activeStreamId.current = null;
      setStreaming(false);
    }
    setConversations((items) => items.filter((item) => item.id !== conversation.id));
    persistConversations();
    if (activeId === conversation.id) {
      setActiveId(null);
      setError('');
    }
  };

  const stopResponse = () => {
    flushRef.current?.();
    flushRef.current = null;
    removePendingAssistant(activeStreamId.current);
    abortRef.current?.abort();
    abortRef.current = null;
    activeStreamId.current = null;
    setStreaming(false);
  };

  const sendMessage = async (event?: FormEvent, suggestedText?: string) => {
    event?.preventDefault();
    if (abortRef.current || streaming) return;
    const prompt = (suggestedText ?? draft).trim();
    if (!prompt) return;
    if (prompt.length > 12000) { setError('Your message is too long. Please keep it under 12,000 characters.'); return; }
    const requestDeepthink = deepthink;

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
    const requestMessages = prepareRequestMessages(fullMessages);
    const assistantMessage: ChatMessage = { role: 'assistant', content: '', deepthink: requestDeepthink };
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
    setVisibleReply({ id: conversationId, content: '' });
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const controller = new AbortController();
    abortRef.current = controller;
    activeStreamId.current = conversationId;
    let received = '';
    let shown = 0;
    let timer: number | null = null;
    let drainResolve: (() => void) | null = null;
    let pendingMessage = assistantMessage;
    let dirtyMessage = false;
    const commitMessage = () => {
      if (!dirtyMessage) return;
      dirtyMessage = false;
      const snapshot = pendingMessage;
      updateConversation(conversationId, (item) => ({
      ...item,
      messages: item.messages.map((message, index) =>
        index === item.messages.length - 1 && message.role === 'assistant' ? snapshot : message),
      updatedAt: Date.now(),
      }));
    };
    const patchLast = (fn: (m: ChatMessage) => ChatMessage) => {
      pendingMessage = fn(pendingMessage);
      dirtyMessage = true;
      pump();
    };
    // Persist complete received text separately from its animated presentation.
    const writeShown = () => setVisibleReply({ id: conversationId, content: received.slice(0, shown) });
    const tick = () => {
      if (abortRef.current !== controller) { timer = null; return; }
      commitMessage();
      const remaining = received.length - shown;
      if (remaining <= 0) {
        timer = null;
        drainResolve?.(); drainResolve = null;
        return;
      }
      shown = prefersReducedMotion() ? received.length : Math.min(received.length, shown + Math.max(2, Math.ceil(remaining / 14)));
      writeShown();
      timer = window.setTimeout(tick, 50);
    };
    const pump = () => { if (timer === null) timer = window.setTimeout(tick, 50); };
    const drain = () => new Promise<void>((resolve) => {
      if (shown >= received.length && timer === null) return resolve();
      drainResolve = resolve; pump();
    });
    const flushOutput = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (abortRef.current === controller) {
        commitMessage();
        if (shown < received.length) { shown = received.length; writeShown(); }
        persistConversations();
      }
      drainResolve?.();
      drainResolve = null;
    };
    flushRef.current = flushOutput;
    controller.signal.addEventListener('abort', flushOutput, { once: true });
    const deadline = window.setTimeout(() => controller.abort(new Error('The response timed out. Your partial answer is kept; please try again.')), 180000);
    const connectTimeout = window.setTimeout(() => controller.abort(new Error('The server did not respond in time. Please try again.')), 30000);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        credentials: 'include',
        body: JSON.stringify({ messages: requestMessages, deepthink: requestDeepthink, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        signal: controller.signal,
      });
      window.clearTimeout(connectTimeout);
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

      const acceptEvent = (eventData: StreamEvent) => {
        if (abortRef.current !== controller) return;
        if (eventData.error) throw new Error(eventData.error);
        if (typeof eventData.content === 'string') {
          received += eventData.content;
          patchLast((message) => ({ ...message, content: received }));
          pump();
        }
        if (typeof eventData.reasoning === 'string' && eventData.reasoning) {
          patchLast((m) => ({ ...m, reasoning: (m.reasoning ?? '') + eventData.reasoning }));
        }
        const act = eventData.activity;
        if (act && typeof act.id === 'string' && typeof act.label === 'string') {
          const clean: Activity = { id: act.id, label: act.label, kind: act.kind, status: act.status };
          patchLast((m) => {
            const list = m.activity ?? [];
            return list.some((a) => a.id === act.id)
              ? { ...m, activity: list.map((a) => a.id === act.id ? { ...a, ...Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== undefined)) } : a) }
              : { ...m, activity: [...list, clean] };
          });
        }
        const nt = eventData.notice;
        if (nt && typeof nt.id === 'string' && typeof nt.message === 'string') {
          patchLast((m) => (m.notices ?? []).some((n) => n.id === nt.id) ? m : { ...m, notices: [...(m.notices ?? []), { id: nt.id, message: nt.message, model: typeof nt.model === 'string' ? nt.model : undefined }] });
        }
        if (typeof eventData.model === 'string') { const mdl = eventData.model; patchLast((m) => ({ ...m, model: mdl })); }
        if (Array.isArray(eventData.sources)) {
          const incoming = eventData.sources.filter((src) => src && typeof src.url === 'string' && /^https?:\/\//i.test(src.url));
          if (incoming.length) patchLast((m) => {
            const list = [...(m.sources ?? [])];
            incoming.forEach((src) => { if (!list.some((x) => x.url === src.url)) list.push({ title: String(src.title ?? ''), url: src.url }); });
            return { ...m, sources: list };
          });
        }
      };
      await consumeChatStream(response.body, controller, acceptEvent);
      await drain();
      if (controller.signal.aborted) return;
      if (!received.trim()) {
        setError('Nexo AI returned an empty response. Try rephrasing or sending again.');
        updateConversation(conversationId, (item) => ({
          ...item,
          messages: item.messages.filter((message, index) =>
            !(index === item.messages.length - 1 && message.role === 'assistant' && !message.content && !message.reasoning)
          ),
          updatedAt: Date.now(),
        }));
      }
    } catch (requestError) {
      if (abortRef.current !== controller) return;
      if (abortRef.current === controller) flushRef.current?.();
      const failure = controller.signal.aborted ? controller.signal.reason : requestError;
      if (failure instanceof Error && failure.name === 'AbortError') return;
      console.warn('[nexo:chat]', { operation: 'stream', aborted: controller.signal.aborted, partial: received.length > 0 });
      setError(failure instanceof Error ? failure.message : 'Something went wrong. Please try again.');
      if (!received) {
        updateConversation(conversationId, (item) => ({
          ...item,
          messages: item.messages.filter((message, index) =>
            !(index === item.messages.length - 1 && message.role === 'assistant' && !message.content && !message.reasoning)
          ),
          updatedAt: Date.now(),
        }));
      }
    } finally {
      window.clearTimeout(deadline);
      window.clearTimeout(connectTimeout);
      flushOutput();
      persistConversations();
      controller.signal.removeEventListener('abort', flushOutput);
      if (timer !== null && abortRef.current !== controller) { window.clearTimeout(timer); timer = null; }
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        activeStreamId.current = null;
        flushRef.current = null;
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
      {activeId && (
        <aside id="history-sidebar" className={`sidebar ${sidebarOpen ? 'is-open' : 'is-collapsed'}`} style={{ ['--sb-w' as string]: `${sidebar.width}px` }} aria-label="Conversation history">
          <div className="brand">
            <button className="brand-home" type="button" onClick={returnHome} aria-label="Go to Nexo AI home" title="Home" data-testid="button-home">
              <img className="brand-mark" src={logoUrl} alt="" aria-hidden="true" data-testid="img-logo" />
              <span className="brand-name">Nexo AI</span>
            </button>
            <button className="icon-btn new-chat" type="button" onClick={createConversation} aria-label="New conversation" title="New conversation" data-testid="button-new-chat">
              <Plus size={18} aria-hidden="true" />
            </button>
            <button type="button" className="icon-btn sb-close-mobile" onClick={() => setSidebarOpen(false)} aria-label="Close history sidebar" data-testid="button-close-sidebar"><X size={16} /></button>
          </div>
          <div className="thread-heading" aria-hidden="true">Recent</div>
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
          <button className="sidebar-settings" type="button" onClick={() => setSettingsOpen(true)} data-testid="button-open-settings">
            <Settings2 size={16} aria-hidden="true" />
            <span>Appearance</span>
          </button>
        </aside>
      )}
      {activeId && sidebarOpen && (
        <div className="sb-sep" role="separator" aria-orientation="vertical" aria-label="Resize conversation history" tabIndex={0}
          aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} aria-valuenow={sidebar.width} {...sidebar.separatorProps} data-testid="separator-sidebar" />
      )}
      {activeId && (
        <button
          className={`scrim ${sidebarOpen ? 'is-visible' : ''}`}
          type="button"
          aria-label="Close conversation menu"
          onClick={() => setSidebarOpen(false)}
          tabIndex={sidebarOpen ? 0 : -1}
          data-testid="button-close-menu-overlay"
        />
      )}
      <main className="main-pane">
        <header className={`topbar ${activeId ? '' : 'is-home'}`}>
          <div className="topbar-left">
            <button className="icon-btn topbar-home" type="button" onClick={returnHome} aria-label="Go to Nexo AI home" title="Home" data-testid="button-topbar-home">
              <img src={logoUrl} alt="" aria-hidden="true" />
            </button>
            {activeId && (
              <button className="icon-btn" type="button" onClick={() => setSidebarOpen((v) => !v)} aria-label={sidebarOpen ? 'Close history sidebar' : 'Open history sidebar'} aria-expanded={sidebarOpen} aria-controls="history-sidebar" data-testid="button-toggle-sidebar">
                <PanelLeft size={18} />
              </button>
            )}
            <div className="context-title" title={activeConversation?.title ?? (activeId ? 'New conversation' : 'Home')}>
              {activeConversation?.title ?? (activeId ? 'New conversation' : 'Home')}
            </div>
          </div>
          {!activeId && (
            <button className="icon-btn home-settings" type="button" onClick={() => setSettingsOpen(true)} aria-label="Appearance" title="Appearance" data-testid="button-home-settings">
              <Settings2 size={17} aria-hidden="true" />
            </button>
          )}
        </header>

        <section className={`chat-region ${activeId ? '' : 'home-region'}`} aria-label={activeId ? 'AI conversation' : 'Nexo AI home'}>
          <div className="messages" aria-live="polite" aria-relevant="additions text" data-testid="chat-messages">
            {currentMessages.length === 0 ? (
              activeId ? (
                <div className="welcome" data-testid="welcome-screen">
                  <img className="welcome-logo" src={logoUrl} alt="" aria-hidden="true" />
                  <h1>What are we<br /><em className="hero-accent">working on?</em></h1>
                  <p>Your conversation is ready. Ask a question, shape an idea, or start building.</p>
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
                        <span className="suggestion-label">{suggestion.label}<ArrowUpRight size={14} className="suggestion-arrow" aria-hidden="true" /></span>
                        <span className="suggestion-text">{suggestion.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <HomeLanding
                  logoUrl={logoUrl}
                  prompts={suggestions}
                  onStart={createConversation}
                  onPrompt={(text) => void sendMessage(undefined, text)}
                />
              )
            ) : (
              <div className="conversation-flow" data-testid={`active-conversation-${activeConversation?.id ?? 'none'}`}>
                {currentMessages.map((message, index) => {
                  const isLive = streaming && activeStreamId.current === activeConversation?.id && message.role === 'assistant' && index === currentMessages.length - 1;
                  const displayContent = isLive && visibleReply?.id === activeConversation?.id ? visibleReply.content : message.content;
                  const isPending = isLive && !displayContent;
                  const replyDeepthink = message.deepthink ?? deepthink;
                  return (
                    <article className={`message-row ${message.role}`} key={`${activeConversation?.id}-${index}`} data-testid={`message-${message.role}-${index}`}>
                      <div className={`avatar ${message.role === 'user' ? 'user-avatar is-blank' : ''}`} aria-hidden="true">
                        {message.role === 'assistant' && <img src={logoUrl} alt="" />}
                      </div>
                      <div className="message-content">
                        {message.role === 'assistant' && <NoticeBanner notices={message.notices} index={index} />}
                        {message.role === 'assistant' && <ThinkingPanel message={message} live={isLive} index={index} />}
                        <div className={`message-text ${message.role === 'assistant' ? 'markdown' : ''}`} data-testid={`message-content-${index}`}>
                          {isPending ? (isSearching(message, isLive) ? null : <ReplyStatus mode={replyDeepthink ? 'deep' : 'normal'} />) : message.role === 'assistant' ? (
                            <MessageMarkdown content={displayContent} />
                          ) : message.content}
                          {isLive && displayContent && replyDeepthink && !isSearching(message, isLive) && <ReplyStatus mode="deep" compact />}
                          {isLive && displayContent && <span className="typing-caret" aria-hidden="true" />}
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
            <form className={`composer-wrap ${deepthink ? 'is-deep' : ''}`} onSubmit={(event) => void sendMessage(event)} aria-label="Send a message">
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
              </div>
              <div className="composer-hint">
                <button type="button" aria-pressed={deepthink} aria-label={`Deepthink ${deepthink ? 'on' : 'off'}${streaming ? ' for the next message' : ''}`} className={`deep-toggle ${deepthink ? 'is-on' : ''}`} title={streaming ? 'Changes apply to your next message; this reply keeps its original mode' : deepthink ? 'Deepthink is on: use deeper reasoning' : 'Turn on Deepthink for deeper reasoning'} onClick={() => setDeepthink((v) => !v)} data-testid="toggle-deepthink">
                  <span className="deep-icon"><Brain size={15} aria-hidden="true" /></span><span>Deepthink{deepthink ? ' on' : ''}</span>
                </button>
                <span className="hint-keys">Enter to send · Shift + Enter for new line</span>
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
            </form>
          </div>
        </section>
      </main>
      {workspaceOpen && (
        <Suspense fallback={null}>
        <CodeWorkspace conversationId={activeId} snippets={snippets} onClose={() => setWorkspaceOpen(false)} canAsk={!streaming}
          isLight={theme.isLight} onAskFix={(text) => void sendMessage(undefined, text)} />
        </Suspense>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} themeId={theme.themeId} accentId={theme.accentId}
        setTheme={theme.setTheme} setAccent={theme.setAccent} />
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
