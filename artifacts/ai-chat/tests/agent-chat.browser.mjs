import assert from "node:assert/strict";
import { delay, waitFor, withFixture } from "./browser-harness.mjs";

const liveEvents = process.env.NEXO_LIVE_AGENT_EVENTS ? JSON.parse(process.env.NEXO_LIVE_AGENT_EVENTS) : null;
const liveTool = liveEvents?.find((event) => event.agentTool)?.agentTool;
const expectedOutput = liveTool ? "LIVE_BROWSER_OK:42" : "agent-run-ok";
const userPrompt = liveTool
  ? "Use the browser-only JavaScript code tool to print the exact string LIVE_BROWSER_OK:42."
  : "Run a tiny JavaScript example.";

await withFixture("tests/image-chat.html", async ({ cdp, evaluate }) => {
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="button-start-from-home"]'))`), "home screen");
  await evaluate(`(() => {
    const originalFetch = window.fetch.bind(window);
    window.__agentRequests = [];
    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/agent")) {
        const body = JSON.parse(init.body);
        window.__agentRequests.push({ url, body });
        if (window.__agentRequests.length === 1) {
          const events = ${JSON.stringify(liveEvents)} ?? [
            { model: "gemini-3.8-flash" },
            { activity: { id: "agent-code-call-1", label: "Running javascript code in the isolated browser…", kind: "code", status: "running" } },
            { agentTool: {
              tool: "run_code",
              callId: "browser-code-1",
              thoughtSignature: "opaque-browser-signature",
              arguments: { language: "javascript", code: "console.log('agent-run-ok')" },
              history: []
            } },
            { done: true }
          ];
          return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join(""), {
            headers: { "Content-Type": "text/event-stream" }
          });
        }
        if (window.__agentRequests.length === 3) {
          const events = [
            { agentTool: {
              tool: "run_code",
              callId: "browser-code-stop",
              thoughtSignature: "opaque-stop-signature",
              arguments: { language: "javascript", code: "while (true) {}" },
              history: []
            } },
            { done: true }
          ];
          return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join(""), {
            headers: { "Content-Type": "text/event-stream" }
          });
        }
        const events = [
          { content: "The isolated browser printed ${expectedOutput}." },
          { done: true }
        ];
        return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join(""), {
          headers: { "Content-Type": "text/event-stream" }
        });
      }
      return originalFetch(input, init);
    };
  })()`);

  await evaluate(`document.querySelector('[data-testid="button-start-from-home"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="toggle-agent"]'))`), "Agent toggle");
  await evaluate(`document.querySelector('[data-testid="toggle-agent"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="toggle-agent"]').getAttribute("aria-pressed")`), "true");
  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp("Input.insertText", { text: userPrompt });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);

  await waitFor(() => evaluate(`window.__agentRequests.length === 2`), "Agent browser-code continuation", 20000);
  await waitFor(() => evaluate(`document.body.textContent.includes("The isolated browser printed ${expectedOutput}.")`), "Agent final answer", 20000);
  if (!liveTool) {
    await waitFor(() => evaluate(`document.querySelector('[data-testid="panel-workspace"]')?.textContent.includes("${expectedOutput}")`), "generated code and browser output", 30000);
  }
  const requests = await evaluate(`window.__agentRequests`);
  assert.ok(requests.every((request) => request.url.endsWith("/api/agent")));
  assert.equal(requests[0].body.messages.at(-1).content, userPrompt);
  assert.equal(requests[0].body.agentHistory, undefined);
  assert.equal(requests[1].body.agentHistory[0].callId, liveTool?.callId ?? "browser-code-1");
  assert.equal(requests[1].body.agentHistory[0].thoughtSignature, liveTool?.thoughtSignature ?? "opaque-browser-signature");
  assert.match(requests[1].body.agentHistory[0].result, new RegExp(expectedOutput));
  assert.equal(await evaluate(`document.querySelector('[data-testid="toggle-agent"]').getAttribute("aria-pressed")`), "true");
  assert.equal(await evaluate(`Object.keys(localStorage).some(key => key === "nexo-agent" && localStorage.getItem(key) === "1")`), true);

  const activityToggle = await evaluate(`document.querySelector('[data-testid^="toggle-progress-"]')?.getAttribute("aria-label")`);
  assert.match(activityToggle ?? "", /Agent activity/);
  await evaluate(`document.querySelector('[data-testid^="toggle-progress-"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid^="agent-activity-"]')?.textContent.includes("Code finished in the isolated browser")`), "visible tool activity");
  assert.equal(await evaluate(`document.body.textContent.includes("private reasoning")`), false);

  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp("Input.insertText", { text: "Start a code task that I can stop." });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);
  await waitFor(() => evaluate(`window.__agentRequests.length === 3`), "second Agent code request");
  await waitFor(() => evaluate(`document.querySelector('[data-testid="panel-workspace"] .ws-agent-label')?.textContent === "Agent running"`), "running Agent code");
  await evaluate(`document.querySelector('[data-testid="button-stop-response"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('[data-testid="panel-workspace"]')?.textContent.includes("Stopped by you.")`), "Agent code cancellation");
  assert.equal(await evaluate(`window.__agentRequests.length`), 3, "stopped browser code is not sent for another model turn");

  console.log(liveTool
    ? "Live Agent browser check passed: Gemini-generated code ran in isolation and its result was sent in the continuation."
    : "Agent browser checks passed: Gemini route selection, isolated code execution, continuation result, workspace output, and activity panel.");
  await delay(50);
});
