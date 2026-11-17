import test from "node:test";
import assert from "node:assert/strict";
import { createWebSearch as createSearchPipeline } from "../src/lib/web-search.ts";
import { createTavilySearch } from "../src/lib/tavily-client.ts";
import { buildChatRequest } from "../src/lib/chat-request.ts";

const createWebSearch = (dependencies = {}) => createSearchPipeline({ tavilySearch: null, ...dependencies });
const usablePage = (overrides = {}) => ({
  title: "Public source",
  url: "https://example.com/news",
  description: "A current public update.",
  ...overrides,
});

const firecrawlResponse = (pages) => new Response(JSON.stringify({
  success: true,
  data: { web: pages },
}), { headers: { "Content-Type": "application/json" } });

test("missing Firecrawl customer connection falls back to direct public search", async () => {
  let fallbackCalls = 0;
  const search = createWebSearch({
    firecrawlSearch: async () => new Response(
      JSON.stringify({ error: "No customer connection configured" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    ),
    scrapePublicSearch: async () => { fallbackCalls++; return [usablePage()]; },
  });

  const result = await search("latest public update");
  assert.equal(result.provider, "public-scraper");
  assert.equal(result.sources[0].url, "https://example.com/news");
  assert.equal(fallbackCalls, 1);
});

test("Firecrawl rate limits use fallback and temporarily skip the unavailable provider", async () => {
  let clock = 1000;
  let firecrawlCalls = 0;
  const search = createWebSearch({
    now: () => clock,
    firecrawlSearch: async () => { firecrawlCalls++; return new Response("", { status: 429 }); },
    scrapePublicSearch: async (query) => [usablePage({ url: `https://example.com/${encodeURIComponent(query)}` })],
  });

  assert.equal((await search("rate limited one")).provider, "public-scraper");
  assert.equal((await search("rate limited two")).provider, "public-scraper");
  assert.equal(firecrawlCalls, 1);
  clock += 300001;
  await search("rate limited three");
  assert.equal(firecrawlCalls, 2);
});

test("Firecrawl timeout falls back without a live request", async () => {
  let fallbackCalls = 0;
  const search = createWebSearch({
    firecrawlSearch: async () => { throw new DOMException("Timed out", "TimeoutError"); },
    scrapePublicSearch: async () => { fallbackCalls++; return [usablePage()]; },
  });
  assert.equal((await search("timeout case")).provider, "public-scraper");
  assert.equal(fallbackCalls, 1);
});

test("malformed Firecrawl JSON and empty results both use direct scraping", async (t) => {
  const cases = [
    ["malformed JSON", async () => new Response("{not json", { status: 200 })],
    ["empty results", async () => firecrawlResponse([])],
    ["malformed response shape", async () => new Response('{"success":true,"data":{"web":"bad"}}')],
  ];
  for (const [label, firecrawlSearch] of cases) {
    await t.test(label, async () => {
      let fallbackCalls = 0;
      const search = createWebSearch({
        firecrawlSearch,
        scrapePublicSearch: async () => { fallbackCalls++; return [usablePage()]; },
      });
      assert.equal((await search(label)).provider, "public-scraper");
      assert.equal(fallbackCalls, 1);
    });
  }
});

test("unsafe source URLs are excluded and retrieved context stays bounded", async () => {
  const pages = [
    usablePage({ markdown: "A".repeat(5000) }),
    usablePage({ title: "Private host", url: "https://localhost/private", markdown: "must not appear" }),
    usablePage({ title: "Plain HTTP", url: "http://example.net/article", markdown: "must not appear" }),
    usablePage({ title: "Credential URL", url: "https://user:pass@example.org/", markdown: "must not appear" }),
    usablePage({ title: "Second source", url: "https://example.org/news", markdown: "B".repeat(5000) }),
    usablePage({ title: "Third source", url: "https://example.net/news", markdown: "C".repeat(5000) }),
  ];
  const search = createWebSearch({
    firecrawlSearch: async () => firecrawlResponse(pages),
    scrapePublicSearch: async () => assert.fail("Valid Firecrawl results should not fall back"),
  });

  const result = await search("bounded safe context");
  assert.equal(result.provider, "firecrawl");
  assert.deepEqual(result.sources.map((source) => source.url), [
    "https://example.com/news",
    "https://example.org/news",
    "https://example.net/news",
  ]);
  assert.ok(result.context.length <= 6500);
  assert.doesNotMatch(result.context, /must not appear|localhost|user:pass/);
});

test("sources distinguish readable page text from blocked or short-page excerpts", async () => {
  const search = createWebSearch({
    firecrawlSearch: async () => firecrawlResponse([
      usablePage({ markdown: `  ${"Readable page text. ".repeat(15)}  ` }),
      usablePage({
        title: "Blocked page",
        url: "https://example.com/blocked",
        description: "Only this search-result description was available.",
      }),
      usablePage({
        title: "Short page",
        url: "https://example.com/short",
        description: "Short page search result.",
        markdown: "A page returned too little text to verify.",
      }),
    ]),
  });

  const result = await search("page retrieval labels");
  assert.deepEqual(result.sources.map(({ retrieval }) => retrieval), ["page", "search_excerpt", "search_excerpt"]);
  assert.match(result.context, /Scraped page:/);
  assert.match(result.context, /Search excerpt only:/);
  assert.match(result.context, /Only this search-result description was available/);
  assert.doesNotMatch(result.context, /A page returned too little text to verify/);
});

test("successful results are cached until their deterministic expiry", async () => {
  let clock = 5000;
  let calls = 0;
  const search = createWebSearch({
    now: () => clock,
    cacheTtlMs: 100,
    firecrawlSearch: async () => { calls++; return firecrawlResponse([usablePage()]); },
  });

  const fresh = await search("cache me");
  assert.equal(fresh.cached, false);
  assert.equal(fresh.retrievedAt, new Date(5000).toISOString());
  const cached = await search(" CACHE ME ");
  assert.equal(cached.cached, true);
  assert.equal(cached.retrievedAt, fresh.retrievedAt, "cached results retain their original retrieval time");
  assert.equal(calls, 1);
  clock += 101;
  const refreshed = await search("cache me");
  assert.equal(refreshed.cached, false);
  assert.equal(refreshed.retrievedAt, new Date(clock).toISOString());
  assert.notEqual(refreshed.retrievedAt, fresh.retrievedAt);
  assert.equal(calls, 2);
});

test("identical in-flight queries share one retrieval", async () => {
  let calls = 0;
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const search = createWebSearch({
    firecrawlSearch: async () => { calls++; return response; },
  });

  const first = search("same query");
  const second = search(" SAME QUERY ");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveResponse(firecrawlResponse([usablePage()]));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, secondResult);
});

test("total retrieval failure remains an error and chat context forbids invented current facts", async () => {
  const search = createWebSearch({
    firecrawlSearch: async () => new Response("", { status: 503 }),
    scrapePublicSearch: async () => { throw new Error("Public search is unavailable"); },
  });
  await assert.rejects(search("latest unverified fact"), /Public search is unavailable/);

  const request = buildChatRequest(
    { messages: [{ role: "user", content: "What is the latest update?" }] },
    new Date("2026-11-04T12:00:00Z"),
    { searchFailed: true },
  );
  assert.match(request.messages[0].content, /External web search failed/);
  assert.match(request.messages[0].content, /Do not invent recent facts or sources/);
});

test("Tavily client sends a bounded request with its key only in the authorization header", async () => {
  const requests = [];
  const search = createTavilySearch({
    apiKey: "test-tavily-secret",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ results: [] }), { headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(typeof search, "function");
  await search(`  ${"q".repeat(1100)}  `);
  assert.equal(requests[0].url, "https://api.tavily.com/search");
  assert.equal(requests[0].headers.get("authorization"), "Bearer test-tavily-secret");
  assert.equal(requests[0].body.query.length, 1000);
  assert.equal(requests[0].body.search_depth, "basic");
  assert.equal(requests[0].body.max_results, 3);
  assert.equal(requests[0].body.include_answer, false);
  assert.equal(requests[0].body.include_raw_content, true);
  assert.equal(requests[0].url.includes("test-tavily-secret"), false);
  assert.equal(JSON.stringify(requests[0].body).includes("test-tavily-secret"), false);
  assert.equal(createTavilySearch({ apiKey: "" }), undefined);
});

test("Tavily failure logs contain provider diagnostics but no query, key, or response body", async () => {
  const logs = [];
  const query = "private user search phrase";
  const key = "test-tavily-key-must-not-leak";
  const responseBody = "provider body must not leak";
  const search = createSearchPipeline({
    logger: { warn: (fields, message) => logs.push({ fields, message }) },
    tavilySearch: async () => new Response(responseBody, { status: 401 }),
    firecrawlSearch: async () => firecrawlResponse([usablePage()]),
  });

  const result = await search(query);
  assert.equal(result.provider, "firecrawl");
  const logText = JSON.stringify(logs);
  assert.doesNotMatch(logText, new RegExp(query));
  assert.doesNotMatch(logText, new RegExp(key));
  assert.doesNotMatch(logText, new RegExp(responseBody));
  assert.deepEqual(logs, [{
    fields: { service: "tavily", status: 401 },
    message: "Tavily search unavailable",
  }]);
});

test("Tavily results are normalized, bounded, cited, and preferred when usable", async () => {
  let tavilyCalls = 0;
  const search = createSearchPipeline({
    tavilySearch: async (query) => {
      tavilyCalls++;
      assert.equal(query, "current update");
      return new Response(JSON.stringify({
        results: [
          {
            title: "Tavily source",
            url: "https://example.com/current",
            content: "A short current result excerpt.",
            raw_content: "Readable page body. ".repeat(40),
          },
          { title: "Unsafe host", url: "http://localhost/private", content: "Must be excluded." },
        ],
      }), { headers: { "Content-Type": "application/json" } });
    },
    firecrawlSearch: async () => assert.fail("A valid Tavily result should be preferred"),
    scrapePublicSearch: async () => assert.fail("A valid Tavily result should not use public scraping"),
  });

  const result = await search("current update");
  assert.equal(tavilyCalls, 1);
  assert.equal(result.provider, "tavily");
  assert.deepEqual(result.sources, [{
    title: "Tavily source",
    url: "https://example.com/current",
    retrieval: "page",
  }]);
  assert.match(result.context, /Readable page body/);
  assert.doesNotMatch(result.context, /Must be excluded|localhost/);
  assert.ok(result.context.length <= 6500);
});

test("Tavily rate limits fall back to Firecrawl and cool down before retrying", async () => {
  let clock = 1000;
  let tavilyCalls = 0;
  let firecrawlCalls = 0;
  const search = createSearchPipeline({
    now: () => clock,
    tavilySearch: async () => { tavilyCalls++; return new Response("", { status: 429 }); },
    firecrawlSearch: async () => { firecrawlCalls++; return firecrawlResponse([usablePage()]); },
    scrapePublicSearch: async () => assert.fail("Firecrawl should satisfy the fallback"),
  });

  assert.equal((await search("first Tavily query")).provider, "firecrawl");
  assert.equal((await search("second Tavily query")).provider, "firecrawl");
  assert.equal(tavilyCalls, 1);
  assert.equal(firecrawlCalls, 2);
  clock += 300001;
  await search("Tavily cooldown expired");
  assert.equal(tavilyCalls, 2);
});

test("malformed or empty Tavily results fall back through Firecrawl to the public scraper", async (t) => {
  for (const [label, tavilyResponse] of [
    ["malformed JSON", new Response("{not json")],
    ["malformed shape", new Response(JSON.stringify({ items: "invalid" }))],
    ["empty results", new Response(JSON.stringify({ results: [] }))],
    ["oversized body", new Response(`${JSON.stringify({ results: [] })}${" ".repeat(260000)}`)],
  ]) {
    await t.test(label, async () => {
      const search = createSearchPipeline({
        tavilySearch: async () => tavilyResponse,
        firecrawlSearch: async () => new Response("", { status: 503 }),
        scrapePublicSearch: async () => [usablePage({ url: "https://example.com/public-fallback" })],
      });
      const result = await search(`fallback ${label}`);
      assert.equal(result.provider, "public-scraper");
      assert.equal(result.sources[0].url, "https://example.com/public-fallback");
    });
  }
});

test("Tavily results use the shared cache and refresh after expiry", async () => {
  let clock = 3000;
  let calls = 0;
  const search = createSearchPipeline({
    now: () => clock,
    cacheTtlMs: 50,
    tavilySearch: async () => {
      calls++;
      return new Response(JSON.stringify({ results: [{
        title: "Cached Tavily source",
        url: "https://example.com/cached",
        content: "A current result.",
      }] }));
    },
    firecrawlSearch: async () => assert.fail("Tavily should supply cached results"),
  });
  const first = await search("cache Tavily");
  const cached = await search(" CACHE TAVILY ");
  assert.equal(first.provider, "tavily");
  assert.equal(first.cached, false);
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
  clock += 51;
  assert.equal((await search("cache Tavily")).cached, false);
  assert.equal(calls, 2);
});

test("Tavily timeout falls back, while a cancelled request aborts without starting more providers", async () => {
  let fallbackCalls = 0;
  let tavilyAborted = false;
  const timeoutSearch = createSearchPipeline({
    tavilyTimeoutMs: 10,
    tavilySearch: async (_query, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    firecrawlSearch: async () => { fallbackCalls++; return firecrawlResponse([usablePage()]); },
  });
  assert.equal((await timeoutSearch("timeout Tavily")).provider, "firecrawl");
  assert.equal(fallbackCalls, 1);

  const controller = new AbortController();
  const cancelledSearch = createSearchPipeline({
    tavilySearch: async (_query, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { tavilyAborted = true; reject(signal.reason); }, { once: true });
    }),
    firecrawlSearch: async () => assert.fail("Cancelled search must not continue to Firecrawl"),
    scrapePublicSearch: async () => assert.fail("Cancelled search must not continue to public scraping"),
  });
  const request = cancelledSearch("cancel this search", controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(new DOMException("User stopped the request", "AbortError"));
  await assert.rejects(request, /User stopped the request/);
  assert.equal(tavilyAborted, true);
});

test("cancelling one deduplicated search caller does not cancel another caller", async () => {
  let calls = 0;
  let release;
  const search = createSearchPipeline({
    tavilySearch: async () => {
      calls++;
      return new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify({ results: [{
        title: "Shared source", url: "https://example.com/shared", content: "shared",
      }] }))); });
    },
    firecrawlSearch: async () => assert.fail("Tavily should complete both requests"),
  });
  const firstController = new AbortController();
  const first = search("shared query", firstController.signal);
  const second = search("shared query");
  await new Promise((resolve) => setImmediate(resolve));
  firstController.abort(new DOMException("First caller left", "AbortError"));
  await assert.rejects(first, /First caller left/);
  assert.equal(calls, 1);
  release();
  const result = await second;
  assert.equal(result.provider, "tavily");
  assert.equal(result.sources[0].url, "https://example.com/shared");
});
