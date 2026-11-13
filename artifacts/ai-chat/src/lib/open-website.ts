import type { ClassLink } from './class-links';

export type WebsiteOpenTarget = {
  label: string;
  url: string;
  kind: 'website' | 'search';
};

const WEBSITE_ALIASES: Record<string, Omit<WebsiteOpenTarget, 'kind'>> = {
  'google classroom': { label: 'Google Classroom', url: 'https://classroom.google.com/' },
  classroom: { label: 'Google Classroom', url: 'https://classroom.google.com/' },
  google: { label: 'Google', url: 'https://www.google.com/' },
  'google search': { label: 'Google', url: 'https://www.google.com/' },
  gmail: { label: 'Gmail', url: 'https://mail.google.com/' },
  'google drive': { label: 'Google Drive', url: 'https://drive.google.com/' },
  drive: { label: 'Google Drive', url: 'https://drive.google.com/' },
  'google docs': { label: 'Google Docs', url: 'https://docs.google.com/' },
  docs: { label: 'Google Docs', url: 'https://docs.google.com/' },
  'google sheets': { label: 'Google Sheets', url: 'https://sheets.google.com/' },
  sheets: { label: 'Google Sheets', url: 'https://sheets.google.com/' },
  'google slides': { label: 'Google Slides', url: 'https://slides.google.com/' },
  slides: { label: 'Google Slides', url: 'https://slides.google.com/' },
  'google calendar': { label: 'Google Calendar', url: 'https://calendar.google.com/' },
  calendar: { label: 'Google Calendar', url: 'https://calendar.google.com/' },
  'google maps': { label: 'Google Maps', url: 'https://maps.google.com/' },
  maps: { label: 'Google Maps', url: 'https://maps.google.com/' },
  youtube: { label: 'YouTube', url: 'https://www.youtube.com/' },
  wikipedia: { label: 'Wikipedia', url: 'https://www.wikipedia.org/' },
  github: { label: 'GitHub', url: 'https://github.com/' },
  replit: { label: 'Replit', url: 'https://replit.com/' },
  reddit: { label: 'Reddit', url: 'https://www.reddit.com/' },
  discord: { label: 'Discord', url: 'https://discord.com/app' },
  'khan academy': { label: 'Khan Academy', url: 'https://www.khanacademy.org/' },
  quizlet: { label: 'Quizlet', url: 'https://quizlet.com/' },
  desmos: { label: 'Desmos', url: 'https://www.desmos.com/' },
  canvas: { label: 'Canvas', url: 'https://canvas.instructure.com/' },
  schoology: { label: 'Schoology', url: 'https://www.schoology.com/' },
  zoom: { label: 'Zoom', url: 'https://zoom.us/' },
  'microsoft teams': { label: 'Microsoft Teams', url: 'https://teams.microsoft.com/' },
  teams: { label: 'Microsoft Teams', url: 'https://teams.microsoft.com/' },
  outlook: { label: 'Outlook', url: 'https://outlook.live.com/' },
  onedrive: { label: 'OneDrive', url: 'https://onedrive.live.com/' },
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/' },
  claude: { label: 'Claude', url: 'https://claude.ai/' },
  gemini: { label: 'Gemini', url: 'https://gemini.google.com/' },
  bing: { label: 'Bing', url: 'https://www.bing.com/' },
  'duckduckgo': { label: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
};

const DOMAIN_ONLY = /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i;
const DIRECT_URL = /^https?:\/\/[^\s<>"']+$/i;

function cleanTarget(raw: string) {
  return raw
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/^(?:the\s+)?(?:website|web\s*site|webpage|web\s*page|site)\s+(?:(?:for|called|named)\s+)?/i, '')
    .replace(/^(?:(?:this|the)\s+)?(?:link|url|address|web\s+address)\s*[:\-]?\s*/i, '')
    .replace(/^(?:the|my)\s+/i, '')
    .replace(/\s+for\s+me\s*$/i, '')
    .replace(/\s+please\s*$/i, '')
    .replace(/\s+(?:instead|rather)\s*$/i, '')
    .replace(/\s+(?:in\s+(?:a\s+)?(?:new|separate)\s+(?:tab|window)|in\s+the\s+browser)\s*$/i, '')
    .replace(/^[\s"'“`]+|[\s"'”`]+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim();
}

function normalizeClassLinkName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(?:on|in|via)\s+(?:google\s+)?classroom\b/g, ' ')
    .replace(/\bgoogle\s+classroom\b/g, ' ')
    .replace(/\bclassroom\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeHttpUrl(value: string): string | null {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Recognize explicit "open this website" commands, resolve familiar site names,
 * and use a search page when a named website has no confident direct mapping.
 */
export function resolveWebsiteOpenRequest(prompt: string, classLinks: readonly ClassLink[] = []): WebsiteOpenTarget | null {
  const command = prompt.trim().match(
    /^(?:(?:hey|yo)\s+)?(?:nexo(?:\s*[,.:]\s*|\s+))?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:open|visit|go\s+to|launch|navigate\s+to|take\s+me\s+to)\s+(.+)$/i,
  );
  if (!command) return null;

  const rawTarget = command[1].trim();
  const mentionsWebsite = /\b(?:website|web\s*site|webpage|web\s*page|site)\b/i.test(rawTarget);
  const target = cleanTarget(rawTarget);
  if (!target) return null;

  const directUrl = normalizeHttpUrl(target);
  if (directUrl && DIRECT_URL.test(target.startsWith('www.') ? `https://${target}` : target)) {
    const url = new URL(directUrl);
    return { kind: 'website', label: url.hostname.replace(/^www\./i, ''), url: directUrl };
  }
  if (DOMAIN_ONLY.test(target)) {
    const url = normalizeHttpUrl(target);
    if (!url) return null;
    return { kind: 'website', label: new URL(url).hostname.replace(/^www\./i, ''), url };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;

  const normalizedTarget = target.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedClassTarget = normalizeClassLinkName(target);
  const customLink = classLinks.find((link) =>
    [link.label, ...link.aliases].some((name) => normalizeClassLinkName(name) === normalizedClassTarget),
  );
  if (customLink) {
    const url = normalizeHttpUrl(customLink.url);
    if (url) return { kind: 'website', label: customLink.label, url };
  }

  const alias = WEBSITE_ALIASES[normalizedTarget];
  if (alias) return { ...alias, kind: 'website' };

  const isClearlyNotAWebsite = /\b(?:conversation|chat|message|file|folder|document|spreadsheet|presentation|project|workspace|editor|code|settings|sidebar|notes?)\b/i.test(target);
  if (!mentionsWebsite && isClearlyNotAWebsite) return null;

  const searchUrl = new URL('https://www.google.com/search');
  searchUrl.searchParams.set('q', `${target} official website`);
  return { kind: 'search', label: target, url: searchUrl.href };
}
