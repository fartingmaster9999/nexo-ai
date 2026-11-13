export type ClassLink = {
  id: string;
  label: string;
  url: string;
  aliases: string[];
};

export const CLASS_LINKS_STORAGE_KEY = 'nexo-class-links-v1';
const MAX_CLASS_LINKS = 100;
const MAX_IMPORT_BYTES = 512_000;

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeClassLinkUrl(value: string): string | null {
  const input = value.trim();
  if (!input || input.length > 2048) return null;
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeEntries(entries: unknown[]): ClassLink[] {
  if (entries.length > MAX_CLASS_LINKS) throw new Error(`Import up to ${MAX_CLASS_LINKS} links at a time.`);
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Link ${index + 1} is not a valid link entry.`);
    }
    const row = entry as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    const url = typeof row.url === 'string' ? normalizeClassLinkUrl(row.url) : null;
    if (!label || label.length > 120) throw new Error(`Link ${index + 1} needs a name under 120 characters.`);
    if (!url) throw new Error(`Link ${index + 1} needs a valid HTTP or HTTPS address.`);
    const aliases = Array.isArray(row.aliases)
      ? [...new Set(row.aliases.filter((alias): alias is string => typeof alias === 'string')
        .map((alias) => alias.trim()).filter((alias) => alias.length > 0 && alias.length <= 120))]
      : [];
    if (aliases.length > 20) throw new Error(`Link ${index + 1} has too many alternate names.`);
    return {
      id: typeof row.id === 'string' && row.id.trim() ? row.id : makeId(),
      label,
      url,
      aliases,
    };
  });
}

export function createClassLink(label: string, rawUrl: string, aliasesText = ''): ClassLink {
  const entries = normalizeEntries([{
    label,
    url: rawUrl,
    aliases: aliasesText.split(',').map((alias) => alias.trim()).filter(Boolean),
  }]);
  return entries[0];
}

export function parseClassLinksImport(contents: string): ClassLink[] {
  if (contents.length > MAX_IMPORT_BYTES) throw new Error('The links file is too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      Array.isArray((parsed as Record<string, unknown>).links)
      ? (parsed as { links: unknown[] }).links
      : null;
  if (!entries) throw new Error('The file should contain a links array.');
  return normalizeEntries(entries);
}

export function readSavedClassLinks(): ClassLink[] {
  try {
    if (typeof window === 'undefined') return [];
    const saved = window.localStorage.getItem(CLASS_LINKS_STORAGE_KEY);
    return saved ? parseClassLinksImport(saved) : [];
  } catch (error) {
    console.warn('[nexo:class-links]', { operation: 'load', failed: true });
    return [];
  }
}

export function writeSavedClassLinks(links: ClassLink[]) {
  if (links.length > MAX_CLASS_LINKS) throw new Error(`You can save up to ${MAX_CLASS_LINKS} links.`);
  const normalized = normalizeEntries(links);
  window.localStorage.setItem(CLASS_LINKS_STORAGE_KEY, JSON.stringify({ version: 1, links: normalized }));
}
