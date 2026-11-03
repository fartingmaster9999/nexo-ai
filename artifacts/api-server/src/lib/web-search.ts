import { ReplitConnectors } from "@replit/connectors-sdk";
import { extractSearchSources } from "./search-activity";
import { scrapePublicSearch } from "./public-scraper";
import { logger } from "./logger";

type SearchPage = { title: string; url: string; description?: string; markdown?: string };
export type SearchResult = {
  sources: { title: string; url: string }[];
  context: string;
  cached: boolean;
  provider: "firecrawl" | "public-scraper";
};
const cache = new Map<string, { expires: number; result: SearchResult }>();
const pending = new Map<string, Promise<SearchResult>>();
const connectors = new ReplitConnectors();
const proxyFetch = connectors.createProxyFetch("firecrawl");
let firecrawlUnavailableUntil = 0;

export async function searchWeb(query: string): Promise<SearchResult> {
  query = query.trim().slice(0, 1000);
  if (!query) throw new Error("Search query is empty");
  const key = query.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return { ...cached.result, cached: true };
  const active = pending.get(key);
  if (active) return active;
  if (pending.size >= 20) throw new Error("Web search is temporarily busy");
  const task = (async (): Promise<SearchResult> => {
    // One external call searches and scrapes three pages in parallel. No Groq tools.
    let pages: SearchPage[] = [];
    let provider: SearchResult["provider"] = "firecrawl";
    try {
      if (firecrawlUnavailableUntil > Date.now()) throw new Error("Connection not available");
      const response = await proxyFetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query, limit: 3, sources: ["web"], timeout: 12000,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true, timeout: 8000 },
      }),
      signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) {
        logger.warn({ service: "firecrawl", status: response.status }, "External search connection unavailable");
        firecrawlUnavailableUntil = Date.now() + 300000;
        throw new Error("External search is unavailable");
      }
      const body = await response.json() as { success?: boolean; data?: { web?: SearchPage[] } };
      if (!body.success || !body.data?.web?.length) throw new Error("No external search results");
      pages = body.data.web;
    } catch {
      provider = "public-scraper";
      pages = await scrapePublicSearch(query);
    }
    const sources = extractSearchSources([{ type: "external", search_results: { results: pages } }]);
    if (!sources.length) throw new Error("No usable public sources were found");
    const context = sources.map((source, i) => {
      const page = pages.find((p) => p.url === source.url);
      return `[${i + 1}] ${source.title}\n${source.url}\n${page?.markdown ? "Scraped page:" : "Search excerpt only:"} ${(page?.markdown || page?.description || "").slice(0, 1900)}`;
    }).join("\n\n").slice(0, 6500);
    const result: SearchResult = { sources, context, cached: false, provider };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 120000, result });
    return result;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
