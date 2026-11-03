import type { ChatMessage } from '../components/answer-details';

export type Conversation = { id: string; title: string; messages: ChatMessage[]; createdAt: number; updatedAt: number };
export const LEGACY_KEY = 'still-chat-conversations-v1';
export const RECORD_PREFIX = 'nexo-conversation-v2:';
type RecordValue = { conversation: Conversation | null; updatedAt: number };

export function parseConversation(value: unknown): Conversation | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Conversation;
  if (typeof c.id !== 'string' || !c.id || typeof c.title !== 'string' ||
      !Array.isArray(c.messages) || !Number.isFinite(c.createdAt) || !Number.isFinite(c.updatedAt)) return null;
  if (!c.messages.every(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')) return null;
  // Ignore malformed optional metadata without discarding the user's actual text.
  return { ...c, messages: c.messages.map(m => ({
    role: m.role, content: m.content,
    ...(typeof m.reasoning === 'string' ? { reasoning: m.reasoning } : {}),
    ...(typeof m.deepthink === 'boolean' ? { deepthink: m.deepthink } : {}),
    ...(typeof m.model === 'string' ? { model: m.model } : {}),
    activity: Array.isArray(m.activity) ? m.activity.filter(a => a && typeof a.id === 'string' && typeof a.label === 'string') : [],
    sources: Array.isArray(m.sources) ? m.sources.filter(s => s && typeof s.title === 'string' && typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) : [],
    notices: Array.isArray(m.notices) ? m.notices.filter(n => n && typeof n.id === 'string' && typeof n.message === 'string') : [],
  })) };
}

export function parseRecord(raw: string): RecordValue {
  const value = JSON.parse(raw) as RecordValue;
  if (!value || !Number.isFinite(value.updatedAt)) throw new Error('Invalid saved conversation');
  const conversation = value.conversation === null ? null : parseConversation(value.conversation);
  if (value.conversation !== null && !conversation) throw new Error('Invalid saved conversation');
  return { conversation, updatedAt: value.updatedAt };
}

/** Legacy data stays untouched as a backup. Per-chat records avoid cross-tab whole-list overwrites. */
export function loadConversations(storage: Storage, onInvalid: () => void = () => {}): Conversation[] {
  const result = new Map<string, Conversation>();
  const raw = storage.getItem(LEGACY_KEY);
  if (raw) {
    try {
      const legacy: unknown = JSON.parse(raw);
      if (!Array.isArray(legacy)) throw new Error('Invalid saved conversation history');
      for (const item of legacy) {
        const conversation = parseConversation(item);
        if (!conversation) { onInvalid(); continue; }
        result.set(conversation.id, conversation);
      }
    } catch { onInvalid(); }
  }
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(RECORD_PREFIX)) continue;
    try {
      const record = parseRecord(storage.getItem(key)!);
      const id = key.slice(RECORD_PREFIX.length);
      if (record.conversation && record.conversation.id !== id) throw new Error('Invalid saved conversation identity');
      if (record.conversation) result.set(id, record.conversation);
      else result.delete(id);
    } catch { onInvalid(); }
  }
  return [...result.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
