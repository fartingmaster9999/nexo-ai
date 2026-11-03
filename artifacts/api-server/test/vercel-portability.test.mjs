import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createFirecrawlSearch } from "../src/lib/firecrawl-client.ts";

test("direct Firecrawl transport preserves request options and uses only its own endpoint", async () => {
  const signal = new AbortController().signal;
  let request;
  const search = createFirecrawlSearch({
    apiKey: "test-only-key",
    isVercel: true,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response('{"success":true}', { headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await search({
    method: "POST", body: '{"query":"test"}',
    headers: { "Content-Type": "application/json" }, signal,
  });
  assert.equal(request.url, "https://api.firecrawl.dev/v2/search");
  assert.equal(request.init.headers.get("Authorization"), "Bearer test-only-key");
  assert.equal(request.init.headers.get("Content-Type"), "application/json");
  assert.equal(request.init.signal, signal);
  assert.equal(request.init.body, '{"query":"test"}');
  assert.equal(result.status, 200);
});

test("Vercel without direct credentials fails immediately for the scraper fallback", async () => {
  const search = createFirecrawlSearch({
    isVercel: true,
    fetchImpl: async () => { assert.fail("Missing credentials must not send a request"); },
  });
  await assert.rejects(search({}), /credentials are not configured/);
});

test("Vercel transport keeps upstream failure statuses and rejects network failures", async () => {
  const limited = createFirecrawlSearch({
    apiKey: "test-only-key", fetchImpl: async () => new Response("", { status: 429 }),
  });
  assert.equal((await limited({})).status, 429);
  const unavailable = createFirecrawlSearch({
    apiKey: "test-only-key", fetchImpl: async () => { throw new Error("network unavailable"); },
  });
  await assert.rejects(unavailable({}), /network unavailable/);
});

test("Vercel routes API before filesystem and SPA fallback without matching lookalike paths", async () => {
  const config = JSON.parse(await readFile(new URL("../../../vercel.json", import.meta.url), "utf8"));
  const [api, filesystem, spa] = config.routes;
  const pattern = new RegExp(`^(?:${api.src})$`);
  for (const path of ["/api", "/api/chat", "/api/healthz", "/api/unknown"]) assert.ok(pattern.test(path));
  for (const path of ["/", "/apiculture", "/nexo-logo.png"]) assert.ok(!pattern.test(path));
  assert.equal(api.dest, "/api/index");
  assert.equal(filesystem.handle, "filesystem");
  assert.equal(spa.dest, "/index.html");
  assert.equal(config.functions["api/index.mjs"].supportsCancellation, true);
  assert.equal(config.outputDirectory, "artifacts/ai-chat/dist/public");
});
