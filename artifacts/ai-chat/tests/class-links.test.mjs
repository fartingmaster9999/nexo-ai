import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASS_LINKS_STORAGE_KEY,
  createClassLink,
  parseClassLinksImport,
  readSavedClassLinks,
} from "../src/lib/class-links.ts";

test("imports valid class links and normalizes bare hosts to HTTPS", () => {
  const links = parseClassLinksImport(JSON.stringify({
    version: 1,
    links: [{ label: "English classwork", url: "classroom.google.com/u/3/w/example/t/all", aliases: ["ELA work"] }],
  }));
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://classroom.google.com/u/3/w/example/t/all");
  assert.deepEqual(links[0].aliases, ["ELA work"]);
  assert.ok(links[0].id);
});

test("rejects non-web protocols and missing link fields", () => {
  assert.throws(() => createClassLink("Unsafe", "javascript:alert(1)"), /HTTP or HTTPS/);
  assert.throws(() => createClassLink("", "https://example.com"), /needs a name/);
  assert.throws(() => parseClassLinksImport("not json"), /not valid JSON/);
});

test("seeds the supplied course links while keeping links already saved in this browser", () => {
  const values = new Map([[CLASS_LINKS_STORAGE_KEY, JSON.stringify({
    version: 1,
    links: [{ id: "custom", label: "Custom class", url: "https://classroom.google.com/custom", aliases: [] }],
  })]]);
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    },
  });
  try {
    const links = readSavedClassLinks();
    assert.ok(links.some((link) => link.id === "custom"));
    assert.ok(links.some((link) => link.id === "default-literacy-stream"));
    assert.ok(links.some((link) => link.id === "default-classroom-calendar"));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});
