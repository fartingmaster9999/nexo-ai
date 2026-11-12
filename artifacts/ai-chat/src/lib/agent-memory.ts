export type MemoryMessage = { role: 'user' | 'assistant'; content: string };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
type Cache = { model: string; touched: number; entries: Record<string, number[]> };
export const MEMORY_MODEL = 'gemini-embedding-2';
export const MEMORY_PREFIX = 'nexo-agent-memory-v1:';
const DIMENSIONS = 768;
const MAX_CONVERSATIONS = 8;
const volatile = new Map<string, Cache>();
const active = new Map<string, Set<object>>();

function readCache(storage: Store, id: string): Cache {
  let cache: Cache | undefined;
  try {
    const raw = storage.getItem(MEMORY_PREFIX + id);
    if (raw && raw.length < 300_000) cache = JSON.parse(raw);
  } catch { /* Optional vector cache; source conversation is never changed. */ }
  const sessionCache = volatile.get(id);
  if (!cache || (sessionCache && sessionCache.touched >= cache.touched)) cache = sessionCache;
  if (!cache || cache.model !== MEMORY_MODEL || !Number.isFinite(cache.touched) ||
      !cache.entries || typeof cache.entries !== 'object' || Array.isArray(cache.entries)) {
    return { model: MEMORY_MODEL, touched: Date.now(), entries: {} };
  }
  return {
    ...cache,
    entries: Object.fromEntries(Object.entries(cache.entries).slice(-64).filter(([key, vector]) =>
      /^[a-f0-9]{64}$/.test(key) && validVector(vector) &&
      vector.every(value => Number.isInteger(value) && Math.abs(value) <= 127))),
  };
}

function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === DIMENSIONS &&
    value.every(n => typeof n === 'number' && Number.isFinite(n)) && value.some(n => n !== 0);
}

function saveCache(storage: Store, id: string, cache: Cache) {
  volatile.delete(id);
  volatile.set(id, cache);
  while (volatile.size > MAX_CONVERSATIONS) volatile.delete(volatile.keys().next().value!);
  try {
    const records: Array<{ key: string; touched: number }> = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(MEMORY_PREFIX) || key === MEMORY_PREFIX + id) continue;
      try { records.push({ key, touched: JSON.parse(storage.getItem(key)!).touched ?? 0 }); }
      catch { storage.removeItem(key); }
    }
    records.sort((a, b) => b.touched - a.touched);
    for (const record of records.slice(MAX_CONVERSATIONS - 1)) storage.removeItem(record.key);
    storage.setItem(MEMORY_PREFIX + id, JSON.stringify(cache));
  } catch { /* Keep a bounded session cache when browser storage is full or blocked. */ }
}

export function deleteAgentMemoryCache(storage: Store, conversationId: string) {
  active.delete(conversationId); // A late embedding response must not resurrect deleted memory.
  volatile.delete(conversationId);
  storage.removeItem(MEMORY_PREFIX + conversationId);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function quantize(vector: number[]): number[] {
  const peak = Math.max(...vector.map(Math.abs));
  return vector.map(value => Math.round(value / peak * 127));
}

async function digest(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

/** Retrieve whole old turns only; never replace recent messages, source files, or tool evidence. */
export async function retrieveAgentMemory(options: {
  storage: Store;
  conversationId: string;
  messages: MemoryMessage[];
  recent: MemoryMessage[];
  signal: AbortSignal;
  embed: (texts: string[], signal: AbortSignal) => Promise<number[][]>;
}): Promise<MemoryMessage[]> {
  const { storage, conversationId, messages, recent, signal } = options;
  const omitted = messages.slice(0, Math.max(0, messages.length - recent.length));
  if (!omitted.length) return [];
  const turns: MemoryMessage[][] = [];
  for (const message of omitted) {
    if (message.role === 'user') turns.push([]);
    turns.at(-1)?.push({ role: message.role, content: message.content });
  }
  const eligible = turns.filter(turn => turn[0]?.role === 'user' && turn.at(-1)?.role === 'assistant' &&
    turn.length <= 8 && turn.reduce((sum, message) => sum + message.content.length, 0) <= 6000);
  let chars = 0;
  const documents = eligible.slice(-31).reverse().filter(turn => {
    chars += JSON.stringify(turn).length;
    return chars <= 72_000;
  }).reverse();
  if (!documents.length) return [];
  const query = messages.at(-1);
  if (!query || query.role !== 'user') return [];
  const inputs = [
    ...documents.map(turn => `title: Earlier conversation turn | text: ${JSON.stringify(turn)}`),
    `task: search result | query: ${query.content}`,
  ];
  // Long user prompts remain intact in the normal request; do not clip them for memory.
  if (inputs.some(text => text.length > 6500)) return [];
  const keys = await Promise.all(inputs.map(digest));
  const cache = readCache(storage, conversationId);
  const entries: Record<string, number[]> = {};
  for (const key of keys) if (cache.entries[key]) entries[key] = cache.entries[key];
  const missing = keys.map((key, index) => ({ key, index })).filter(({ key }) => !entries[key]);
  const ticket = {};
  const tickets = active.get(conversationId) ?? new Set<object>();
  tickets.add(ticket);
  active.set(conversationId, tickets);
  try {
    signal.throwIfAborted();
    if (missing.length) {
      const vectors = await options.embed(missing.map(({ index }) => inputs[index]), signal);
      signal.throwIfAborted();
      if (vectors.length !== missing.length || vectors.some(vector => !validVector(vector))) {
        throw new Error('Gemini returned invalid conversation memory.');
      }
      missing.forEach(({ key }, index) => { entries[key] = quantize(vectors[index]); });
    }
    if (active.get(conversationId) !== tickets || !tickets.has(ticket)) return [];
    saveCache(storage, conversationId, { model: MEMORY_MODEL, touched: Date.now(), entries });
    const queryVector = entries[keys.at(-1)!];
    const ranked = documents.map((turn, index) => ({
      turn, index, score: cosineSimilarity(entries[keys[index]], queryVector),
    })).filter(item => item.score >= 0.25).sort((a, b) => b.score - a.score);
    const selected: typeof ranked = [];
    let total = 0, count = 0;
    for (const item of ranked) {
      const size = item.turn.reduce((sum, message) => sum + message.content.length, 0);
      if (total + size > 6000 || count + item.turn.length > 8) continue;
      selected.push(item); total += size; count += item.turn.length;
      if (selected.length === 3) break;
    }
    return selected.sort((a, b) => a.index - b.index).flatMap(item => item.turn);
  } finally {
    tickets.delete(ticket);
    if (!tickets.size && active.get(conversationId) === tickets) active.delete(conversationId);
  }
}
