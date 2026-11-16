import assert from "node:assert/strict";
import { waitFor, withFixture } from "./browser-harness.mjs";

await withFixture("tests/image-chat.html", async ({ cdp, evaluate }) => {
  const exists = (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
  const send = async (prompt) => {
    await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
    await cdp("Input.insertText", { text: prompt });
    await click('[data-testid="button-send-message"]');
  };

  await waitFor(() => exists('[data-testid="button-start-from-home"]'), "home screen");
  await evaluate(`(() => {
    window.__nexoCalls = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/chat") || url.endsWith("/api/agent")) {
        const body = JSON.parse(init.body);
        window.__nexoCalls.push({ url, body });
        const events = url.endsWith("/api/chat") ? [
          { activity: { id: "research-search", label: "Searching the web and reading public pages…", kind: "search", status: "running" } },
          { sources: [{ title: "Example Research Source", url: "https://research.example.org/findings" }] },
          { activity: { id: "research-search", label: "Found 1 public source", kind: "search", status: "complete" } },
          { content: "## Key findings\\n\\nEvidence is summarized here. [Source](https://research.example.org/findings)" },
          { done: true }
        ] : [
          { content: "Agent received the coding request." },
          { done: true }
        ];
        return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join(""), {
          headers: { "Content-Type": "text/event-stream" }
        });
      }
      return originalFetch(input, init);
    };
  })()`);

  await click('[data-testid="button-start-from-home"]');
  await waitFor(() => exists('[data-testid="input-message"]'), "new conversation");
  await click('[data-testid="toggle-agent"]');
  await send("Research recent evidence about sleep and memory");
  await waitFor(() => exists('[data-testid="panel-research-brief"]'), "Research Brief panel");
  await waitFor(() => text('[data-testid="research-brief-content"]').then((value) => value.includes("Evidence is summarized")), "sourced research answer");
  assert.equal(await evaluate(`window.__nexoCalls[0]?.url.endsWith("/api/chat")`), true, "research uses regular chat, not the Agent endpoint");
  assert.equal(await evaluate(`window.__nexoCalls[0]?.body.research`), true, "research explicitly requests web search");
  assert.equal(await exists('[data-testid="panel-workspace"]'), false, "research does not open the coding workspace");
  assert.match(await text('[data-testid="panel-research-brief"]'), /Example Research Source/);

  await click('[data-testid="button-close-research-brief"]');
  await waitFor(() => exists('[data-testid="button-open-research-brief"]'), "Research Brief reopen button");
  assert.match(await text('[data-testid="message-content-1"]'), /Evidence is summarized/);
  await click('[data-testid="button-open-research-brief"]');
  await waitFor(() => exists('[data-testid="panel-research-brief"]'), "Research Brief reopened");

  await send("Build me a simple HTML website");
  await waitFor(() => evaluate(`window.__nexoCalls.some(call=>call.url.endsWith("/api/agent"))`), "coding request routed to Agent");
  await waitFor(() => exists('[data-testid="panel-workspace"]'), "Agent coding workspace");
  assert.equal(await exists('[data-testid="panel-research-brief"]'), false, "coding request closes the Research Brief");
  assert.equal(await evaluate(`window.__nexoCalls.at(-1)?.body.research ?? false`), false);
  console.log("Research browser regression passed: research requests open the sourced brief, and Agent coding requests keep the coding workspace.");
});
