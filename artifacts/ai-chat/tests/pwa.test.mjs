import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);

test("PWA manifest contains ChromeOS install metadata and launcher icon sizes", async () => {
  const manifest = JSON.parse(await readFile(new URL("public/manifest.webmanifest", appRoot), "utf8"));
  assert.equal(manifest.name, "Nexo AI");
  assert.equal(manifest.short_name, "Nexo");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("service worker never caches API or WebSocket traffic", async () => {
  const source = await readFile(new URL("public/service-worker.js", appRoot), "utf8");
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /relativePath !== "api" && !relativePath\.startsWith\("api\/"\)/);
  assert.match(source, /relativePath !== "ws" && !relativePath\.startsWith\("ws\/"\)/);
  assert.match(source, /request\.mode === "navigate"/);
});

test("production entry registers the service worker under the Vite base path", async () => {
  const [html, entry] = await Promise.all([
    readFile(new URL("index.html", appRoot), "utf8"),
    readFile(new URL("src/main.tsx", appRoot), "utf8"),
  ]);
  assert.match(html, /rel="manifest" href="%BASE_URL%manifest\.webmanifest"/);
  assert.match(entry, /import\.meta\.env\.PROD/);
  assert.match(entry, /service-worker\.js/);
  assert.match(entry, /scope: appBase\.pathname/);
});
