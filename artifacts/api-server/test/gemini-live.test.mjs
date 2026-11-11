import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createLiveRouter, GEMINI_LIVE_MODEL } from "../src/routes/live.ts";

const fixedNow = new Date("2026-11-10T18:00:00.000Z");

async function withServer(router, run) {
  const app = express();
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function okTokenResponse() {
  return new Response(JSON.stringify({
    name: "ephemeral-live-session-token",
    expireTime: "2026-11-10T18:30:00.000Z",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("private Live token creation uses the server key and locks the session to audio-only Nexo Live", async () => {
  let captured;
  const router = createLiveRouter({
    getApiKey: () => "server-key",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init, body: JSON.parse(init.body) };
      return okTokenResponse();
    },
    now: () => fixedNow,
  });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/live/token`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      token: "ephemeral-live-session-token",
      expiresAt: "2026-11-10T18:30:00.000Z",
      model: GEMINI_LIVE_MODEL,
    });
  });

  assert.equal(captured.url, "https://generativelanguage.googleapis.com/v1beta/auth_tokens");
  assert.equal(captured.init.headers["x-goog-api-key"], "server-key");
  assert.equal(captured.body.uses, 1);
  assert.equal(captured.body.bidiGenerateContentSetup.model, `models/${GEMINI_LIVE_MODEL}`);
  assert.deepEqual(captured.body.bidiGenerateContentSetup.generationConfig.responseModalities, ["AUDIO"]);
  assert.deepEqual(captured.body.bidiGenerateContentSetup.inputAudioTranscription, {});
  assert.deepEqual(captured.body.bidiGenerateContentSetup.outputAudioTranscription, {});
  assert.equal(captured.body.expireTime, "2026-11-10T18:30:00.000Z");
  assert.equal(captured.body.newSessionExpireTime, "2026-11-10T18:01:00.000Z");
  assert.equal(captured.body.bidiGenerateContentSetup.systemInstruction.parts[0].text.includes("Nexo"), true);
});

test("public Live tokens use only the supplied Gemini key and never require Groq", async () => {
  let keyHeader;
  const router = createLiveRouter({
    fetchImpl: async (_url, init) => {
      keyHeader = init.headers["x-goog-api-key"];
      return okTokenResponse();
    },
    now: () => fixedNow,
  });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/public/live/token`, {
      method: "POST",
      headers: {
        "x-vercel-forwarded-for": "198.51.100.41",
        "x-nexo-gemini-key": "visitor-gemini-key",
      },
    });
    assert.equal(response.status, 200);
    await response.json();
  });
  assert.equal(keyHeader, "visitor-gemini-key");
});

test("private and public requests report missing Gemini configuration clearly", async () => {
  const router = createLiveRouter({ getApiKey: () => undefined, now: () => fixedNow });
  await withServer(router, async (baseUrl) => {
    const privateResponse = await fetch(`${baseUrl}/api/live/token`, { method: "POST" });
    assert.equal(privateResponse.status, 503);
    assert.match((await privateResponse.json()).error, /site owner/i);

    const publicResponse = await fetch(`${baseUrl}/api/public/live/token`, {
      method: "POST",
      headers: { "x-vercel-forwarded-for": "198.51.100.42" },
    });
    assert.equal(publicResponse.status, 401);
    assert.match((await publicResponse.json()).error, /Settings/);
  });
});

test("provider rate limits and malformed token responses fail safely", async () => {
  const rateLimited = createLiveRouter({
    getApiKey: () => "server-key",
    fetchImpl: async () => okTokenResponse(),
    now: () => fixedNow,
    rateLimit: 1,
  });
  await withServer(rateLimited, async (baseUrl) => {
    const headers = { "x-vercel-forwarded-for": "198.51.100.43" };
    assert.equal((await fetch(`${baseUrl}/api/live/token`, { method: "POST", headers })).status, 200);
    const response = await fetch(`${baseUrl}/api/live/token`, { method: "POST", headers });
    assert.equal(response.status, 429);
  });

  const malformed = createLiveRouter({
    getApiKey: () => "server-key",
    fetchImpl: async () => new Response(JSON.stringify({ name: "" }), { status: 200 }),
    now: () => fixedNow,
  });
  await withServer(malformed, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/live/token`, {
      method: "POST",
      headers: { "x-vercel-forwarded-for": "198.51.100.44" },
    });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /invalid Live session token/i);
  });
});

test("Gemini rate-limit errors stay distinguishable and upstream error bodies are not exposed", async () => {
  const router = createLiveRouter({
    getApiKey: () => "server-key",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "sensitive upstream detail" } }), { status: 429 }),
    now: () => fixedNow,
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/live/token`, {
      method: "POST",
      headers: { "x-vercel-forwarded-for": "198.51.100.45" },
    });
    assert.equal(response.status, 429);
    const body = await response.json();
    assert.match(body.error, /temporarily rate-limited/);
    assert.doesNotMatch(body.error, /sensitive upstream detail/);
  });
});

test("Gemini access and configuration errors are safe and actionable", async () => {
  for (const [status, expected] of [[401, /denied Live access/], [403, /denied Live access/], [400, /configuration/], [404, /configuration/], [503, /service status/]]) {
    const router = createLiveRouter({
      getApiKey: () => "test-server-key", rateLimit: 100,
      fetchImpl: async () => new Response("sensitive provider response", { status }),
    });
    await withServer(router, async (url) => {
      const response = await fetch(`${url}/api/live/token`, { method: "POST" });
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.match(body.error, expected);
      assert.doesNotMatch(body.error, /sensitive/);
    });
  }
});

test("Live token timeout aborts the provider and returns a retryable error", async () => {
  let aborted = false;
  const router = createLiveRouter({
    getApiKey: () => "test-server-key", rateLimit: 100, tokenTimeoutMs: 20,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
    }),
  });
  await withServer(router, async (url) => {
    const response = await fetch(`${url}/api/live/token`, { method: "POST" });
    assert.equal(response.status, 504);
    assert.equal(aborted, true);
    assert.match((await response.json()).error, /took too long/);
  });
});

test("invalid provider JSON does not expose parser details or credentials", async () => {
  const router = createLiveRouter({
    getApiKey: () => "test-server-key", rateLimit: 100,
    fetchImpl: async () => new Response("not-json-sensitive-token", { status: 200 }),
  });
  await withServer(router, async (url) => {
    const response = await fetch(`${url}/api/live/token`, { method: "POST" });
    assert.equal(response.status, 502);
    assert.doesNotMatch(JSON.stringify(await response.json()), /sensitive|test-server-key/);
  });
});
