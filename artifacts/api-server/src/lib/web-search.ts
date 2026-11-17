import { createFirecrawlSearch } from "./firecrawl-client";
import { extractSearchSources } from "./search-activity";
import { isPublicUrl, scrapePublicSearch as defaultScrapePublicSearch, type ScrapedPage } from "./public-scraper";
import { logger } from "./logger";
import { createTavilySearch, type TavilySearch } from "./tavily-client";

type SearchPage = ScrapedPage;
const MIN_PAGE_TEXT_CHARS = 200;
const TAVILY_TIMEOUT_MS = 9000;
const FIRECRAWL_TIMEOUT_MS = 18000;
const PROVIDER_COOLDOWN_MS = 300000;
const MAX_TAVILY_RESPONSE_BYTES = 256000;
function hasReadablePageText(markdown: string | undefined): markdown is string {
  return typeof markdown === "string" && markdown.replace(/\s+/g, " ").trim().length >= MIN_PAGE_TEXT_CHARS;
}

export type SearchResult = {
  sources: { title: string; url: string; retrieval: "page" | "search_excerpt" }[];
  context: string;
  cached: boolean;
  provider: "tavily" | "firecrawl" | "public-scraper";
  retrievedAt: string;
};
type WebSearchDependencies = {
  tavilySearch?: TavilySearch | null;
  firecrawlSearch?: (init: RequestInit) => Promise<Response>;
  scrapePublicSearch?: (query: string, signal?: AbortSignal) => Promise<SearchPage[]>;
  logger?: Pick<typeof logger, "warn">;
  tavilyTimeoutMs?: number;
  firecrawlTimeoutMs?: number;
  now?: () => number;
  cacheTtlMs?: number;
};

type PendingSearch = {
  controller: AbortController;
  promise: Promise<SearchResult>;
  subscribers: number;
  settled: boolean;
};

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("The search was cancelled.", "AbortError");
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

function providerSignal(signal: AbortSignal, timeoutMs: number) {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function normalizeTavilyResults(value: unknown): { pages: SearchPage[]; malformed: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { pages: [], malformed: true };
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return { pages: [], malformed: true };
  const pages: SearchPage[] = [];
  for (const value of results.slice(0, 3)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const result = value as Record<string, unknown>;
    if (typeof result.url !== "string" || typeof result.title !== "string" || !isPublicUrl(result.url)) continue;
    const url = new URL(result.url).href;
    const page: SearchPage = {
      title: result.title.trim().slice(0, 200) || new URL(url).hostname,
      url,
    };
    if (typeof result.content === "string") page.description = result.content.slice(0, 1200);
    if (typeof result.raw_content === "string" && result.raw_content.trim()) {
      page.markdown = result.raw_content.slice(0, 3500);
    }
    pages.push(page);
  }
  return { pages, malformed: false };
}

async function readTavilyJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("Tavily returned an empty response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_TAVILY_RESPONSE_BYTES) throw new RangeError("Tavily response exceeded the size limit");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    signal.throwIfAborted();
    return JSON.parse(text);
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function createWebSearch(dependencies: WebSearchDependencies = {}) {
  const {
    tavilySearch: providedTavilySearch,
    logger: searchLogger = logger,
    firecrawlSearch = createFirecrawlSearch({
      apiKey: process.env.FIRECRAWL_API_KEY,
      isVercel: process.env.VERCEL === "1",
    }),
    scrapePublicSearch = defaultScrapePublicSearch,
    tavilyTimeoutMs = TAVILY_TIMEOUT_MS,
    firecrawlTimeoutMs = FIRECRAWL_TIMEOUT_MS,
    now = Date.now,
    cacheTtlMs = 120000,
  } = dependencies;
  const tavilySearch = providedTavilySearch === undefined
    ? createTavilySearch()
    : providedTavilySearch ?? undefined;
  const cache = new Map<string, { expires: number; result: SearchResult }>();
  const pending = new Map<string, PendingSearch>();
  let tavilyUnavailableUntil = 0;
  let firecrawlUnavailableUntil = 0;

  async function retrieve(query: string, signal: AbortSignal): Promise<SearchResult> {
    let pages: SearchPage[] = [];
    let provider: SearchResult["provider"] = "tavily";

    if (tavilySearch && tavilyUnavailableUntil <= now()) {
      try {
        const requestSignal = providerSignal(signal, tavilyTimeoutMs);
        const response = await tavilySearch(query, requestSignal);
        if (!response.ok) {
          if ([401, 403, 404, 429].includes(response.status) || response.status >= 500) {
            tavilyUnavailableUntil = now() + PROVIDER_COOLDOWN_MS;
          }
          searchLogger.warn({ service: "tavily", status: response.status }, "Tavily search unavailable");
          await response.body?.cancel().catch(() => {});
        } else {
          const normalized = normalizeTavilyResults(await readTavilyJson(response, requestSignal));
          if (normalized.malformed) {
            tavilyUnavailableUntil = now() + PROVIDER_COOLDOWN_MS;
            searchLogger.warn({ service: "tavily", status: response.status }, "Tavily returned an invalid search response");
          } else {
            pages = normalized.pages;
          }
        }
      } catch (error) {
        if (signal.aborted) throw abortReason(signal);
        tavilyUnavailableUntil = now() + PROVIDER_COOLDOWN_MS;
        searchLogger.warn({
          service: "tavily",
          failureKind: error instanceof Error ? error.name : "unknown",
        }, "Tavily search could not be completed");
      }
    }

    if (signal.aborted) throw abortReason(signal);
    if (!pages.length) {
      provider = "firecrawl";
      try {
        if (firecrawlUnavailableUntil > now()) throw new Error("Search provider is cooling down");
        const response = await firecrawlSearch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query, limit: 3, sources: ["web"], timeout: 12000,
            scrapeOptions: { formats: ["markdown"], onlyMainContent: true, timeout: 8000 },
          }),
          signal: providerSignal(signal, firecrawlTimeoutMs),
        });
        if (!response.ok) {
          searchLogger.warn({ service: "firecrawl", status: response.status }, "External search connection unavailable");
          firecrawlUnavailableUntil = now() + PROVIDER_COOLDOWN_MS;
          await response.body?.cancel().catch(() => {});
        } else {
          const body = await response.json() as {
            success?: unknown;
            data?: { web?: unknown } | null;
          } | null;
          const results = body?.success === true && Array.isArray(body.data?.web)
            ? body.data.web
            : [];
          pages = results.filter((page): page is SearchPage =>
            typeof page === "object" && page !== null
            && typeof page.title === "string" && typeof page.url === "string"
            && (page.description === undefined || typeof page.description === "string")
            && (page.markdown === undefined || typeof page.markdown === "string"));
        }
      } catch (error) {
        if (signal.aborted) throw abortReason(signal);
        // Continue to the public scraper after any provider, parsing, or timeout failure.
      }
    }

    if (signal.aborted) throw abortReason(signal);
    if (!pages.length) {
      provider = "public-scraper";
      pages = await scrapePublicSearch(query, signal);
    }

    if (signal.aborted) throw abortReason(signal);
    const sources = extractSearchSources([{ type: "external", search_results: { results: pages } }])
      .filter((source) => isPublicUrl(source.url));
    if (!sources.length) throw new Error("No usable public sources were found");
    const context = sources.map((source, i) => {
      const page = pages.find((p) => p.url === source.url);
      const markdown = page?.markdown;
      const pageRead = hasReadablePageText(markdown);
      const pageLabel = provider === "firecrawl" ? "Scraped page:" : "Retrieved page content:";
      return `[${i + 1}] ${source.title}\n${source.url}\n${pageRead ? pageLabel : "Search excerpt only:"} ${(pageRead ? markdown : page?.description || "").slice(0, 1900)}`;
    }).join("\n\n").slice(0, 6500);
    const retrievedAtMs = now();
    return {
      sources: sources.map((source) => {
        const page = pages.find((candidate) => candidate.url === source.url);
        return { ...source, retrieval: hasReadablePageText(page?.markdown) ? "page" as const : "search_excerpt" as const };
      }),
      context,
      cached: false,
      provider,
      retrievedAt: new Date(retrievedAtMs).toISOString(),
    };
  }

  return async function searchWeb(query: string, requestSignal?: AbortSignal): Promise<SearchResult> {
    query = query.trim().slice(0, 1000);
    if (!query) throw new Error("Search query is empty");
    requestSignal?.throwIfAborted();
    const key = query.toLowerCase().trim();
    const cached = cache.get(key);
    if (cached && cached.expires > now()) {
      return waitForCaller(Promise.resolve({
        ...cached.result,
        sources: cached.result.sources.map((source) => ({ ...source })),
        cached: true,
      }), requestSignal);
    }
    let active = pending.get(key);
    if (active?.controller.signal.aborted) active = undefined;
    if (!active) {
      if (pending.size >= 20) throw new Error("Web search is temporarily busy");
      const controller = new AbortController();
      const entry: PendingSearch = {
        controller,
        promise: Promise.resolve(undefined as never),
        subscribers: 0,
        settled: false,
      };
      entry.promise = retrieve(query, controller.signal).then((result) => {
        if (!controller.signal.aborted) {
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(key, { expires: now() + cacheTtlMs, result });
        }
        return result;
      }).finally(() => {
        entry.settled = true;
        if (pending.get(key) === entry) pending.delete(key);
      });
      pending.set(key, entry);
      active = entry;
    }
    active.subscribers++;
    try {
      return await waitForCaller(active.promise, requestSignal);
    } finally {
      active.subscribers--;
      if (!active.subscribers && !active.settled) {
        active.controller.abort(new DOMException("No active requests remain for this search.", "AbortError"));
      }
    }
  };
}

export const searchWeb = createWebSearch();
