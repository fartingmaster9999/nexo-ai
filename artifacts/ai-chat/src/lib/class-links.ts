export type ClassLink = {
  id: string;
  label: string;
  url: string;
  aliases: string[];
};

export const CLASS_LINKS_STORAGE_KEY = 'nexo-class-links-v1';
const MAX_CLASS_LINKS = 100;
const MAX_IMPORT_BYTES = 512_000;
const CLASS_LINKS_DEFAULTS_KEY = 'nexo-class-links-defaults-v1';

export const DEFAULT_CLASS_LINKS: ClassLink[] = [
  { id: 'default-literacy-stream', label: 'Literacy stream', url: 'https://classroom.google.com/u/3/c/ODU1OTI2OTUwOTY2', aliases: ['literacy', 'english', 'english stream', 'english/literacy', 'lit', 'lit stream'] },
  { id: 'default-literacy-classwork', label: 'Literacy classwork', url: 'https://classroom.google.com/u/3/w/ODU1OTI2OTUwOTY2/t/all', aliases: ['lit classwork', 'english classwork', 'literacy assignments', 'lit assignments'] },
  { id: 'default-science-stream', label: 'Science stream', url: 'https://classroom.google.com/u/3/c/ODU1OTgyMzI2MTU0', aliases: ['science'] },
  { id: 'default-science-classwork', label: 'Science classwork', url: 'https://classroom.google.com/u/3/w/ODU1OTgyMzI2MTU0/t/all', aliases: ['science assignments'] },
  { id: 'default-social-studies-stream', label: 'Social studies stream', url: 'https://classroom.google.com/u/3/c/ODc0NTE0MDgwNDAz', aliases: ['social studies', 'history', 'history stream'] },
  { id: 'default-social-studies-classwork', label: 'Social studies classwork', url: 'https://classroom.google.com/u/3/w/ODc0NTE0MDgwNDAz/t/all', aliases: ['history classwork', 'social studies assignments', 'history assignments'] },
  { id: 'default-spanish-stream', label: 'Spanish stream', url: 'https://classroom.google.com/u/3/c/ODc0OTk0NTc1NjI5', aliases: ['spanish'] },
  { id: 'default-spanish-classwork', label: 'Spanish classwork', url: 'https://classroom.google.com/u/3/w/ODc0OTk0NTc1NjI5/t/all', aliases: ['spanish assignments'] },
  { id: 'default-math-stream', label: 'Math stream', url: 'https://classroom.google.com/u/3/c/ODU1ODk4NjA4ODkz', aliases: ['math'] },
  { id: 'default-math-classwork', label: 'Math classwork', url: 'https://classroom.google.com/u/3/c/ODU1ODk4NjA4ODkz', aliases: ['math assignments'] },
  { id: 'default-pe-stream', label: 'PE stream', url: 'https://classroom.google.com/u/3/c/ODcyNDI0MTQ4ODcy', aliases: ['pe', 'physical education'] },
  { id: 'default-pe-classwork', label: 'PE classwork', url: 'https://classroom.google.com/u/3/c/ODcyNDI0MTQ4ODcy', aliases: ['pe assignments', 'physical education classwork'] },
  { id: 'default-forum-stream', label: '7th grade forum stream', url: 'https://classroom.google.com/u/3/c/ODc1MDMwMTU2MzY0', aliases: ['7th grade forum', 'forum', 'forum stream'] },
  { id: 'default-forum-classwork', label: '7th grade forum classwork', url: 'https://classroom.google.com/u/3/c/ODc1MDMwMTU2MzY0', aliases: ['forum classwork'] },
  { id: 'default-advisory-stream', label: 'Advisory stream', url: 'https://classroom.google.com/u/3/c/ODcyNjAxNzQ1ODMx', aliases: ['advisory'] },
  { id: 'default-advisory-classwork', label: 'Advisory classwork', url: 'https://classroom.google.com/u/3/w/ODcyNjAxNzQ1ODMx/t/all', aliases: ['advisory assignments'] },
  { id: 'default-art-stream', label: 'Art stream', url: 'https://classroom.google.com/u/3/c/ODkzMjgyODY0NzIy', aliases: ['art'] },
  { id: 'default-art-classwork', label: 'Art classwork', url: 'https://classroom.google.com/u/3/w/ODkzMjgyODY0NzIy/t/all', aliases: ['art assignments'] },
  { id: 'default-classroom-todo', label: 'Classroom to do', url: 'https://classroom.google.com/u/3/a/not-turned-in/all', aliases: ['to do', 'todo', 'not turned in', 'missing assignments'] },
  { id: 'default-classroom-calendar', label: 'Classroom calendar', url: 'https://classroom.google.com/u/3/calendar/this-week/course/all', aliases: ['class calendar', 'classroom calendar'] },
];

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
    if (!saved) {
      const defaults = DEFAULT_CLASS_LINKS.map((link) => ({ ...link, aliases: [...link.aliases] }));
      writeSavedClassLinks(defaults);
      return defaults;
    }

    const links = parseClassLinksImport(saved);
    if (window.localStorage.getItem(CLASS_LINKS_DEFAULTS_KEY) === '1') return links;

    const existingIds = new Set(links.map((link) => link.id));
    const existingLabels = new Set(links.map((link) => link.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
    const missingDefaults = DEFAULT_CLASS_LINKS.filter((link) =>
      !existingIds.has(link.id) && !existingLabels.has(link.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()),
    );
    const migrated = [...missingDefaults, ...links];
    writeSavedClassLinks(migrated);
    return migrated;
  } catch (error) {
    console.warn('[nexo:class-links]', { operation: 'load', failed: true });
    return DEFAULT_CLASS_LINKS.map((link) => ({ ...link, aliases: [...link.aliases] }));
  }
}

export function writeSavedClassLinks(links: ClassLink[]) {
  if (links.length > MAX_CLASS_LINKS) throw new Error(`You can save up to ${MAX_CLASS_LINKS} links.`);
  const normalized = normalizeEntries(links);
  window.localStorage.setItem(CLASS_LINKS_STORAGE_KEY, JSON.stringify({ version: 1, links: normalized }));
  window.localStorage.setItem(CLASS_LINKS_DEFAULTS_KEY, '1');
}
