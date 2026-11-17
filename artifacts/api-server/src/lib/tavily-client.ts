const SEARCH_URL = "https://api.tavily.com/search";
const MAX_QUERY_CHARS = 1000;

type TavilyOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export type TavilySearch = (query: string, signal?: AbortSignal) => Promise<Response>;

/**
 * Keep Tavily credentials in the API service. The direct client is used by
 * Replit and Vercel; the Replit MCP connector is not an app-runtime API.
 */
export function createTavilySearch({
  apiKey = process.env.TAVILY_API_KEY,
  fetchImpl = fetch,
}: TavilyOptions = {}): TavilySearch | undefined {
  const key = apiKey?.trim();
  if (!key) return undefined;

  return (query, signal) => fetchImpl(SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: query.trim().slice(0, MAX_QUERY_CHARS),
      search_depth: "basic",
      max_results: 3,
      include_answer: false,
      include_raw_content: true,
      safe_search: true,
    }),
    ...(signal ? { signal } : {}),
  });
}
