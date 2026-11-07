import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { delay, waitFor, withFixture } from "./browser-harness.mjs";

const temp = await mkdtemp(path.join(tmpdir(), "nexo-agent-image-"));
const imagePath = path.join(temp, "chart.png");
const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLKrQAAAABJRU5ErkJggg==";
await writeFile(imagePath, Buffer.from(imageBase64, "base64"));
const liveEvents = process.env.NEXO_LIVE_AGENT_EVENTS ? JSON.parse(process.env.NEXO_LIVE_AGENT_EVENTS) : null;
const liveTool = liveEvents?.find((event) => event.agentTool)?.agentTool;
const expectedOutput = liveTool ? "LIVE_BROWSER_OK:42" : "agent-run-ok";
const userPrompt = liveTool
  ? "Use the browser-only JavaScript code tool to print the exact string LIVE_BROWSER_OK:42."
  : "Run a tiny JavaScript example.";

try {
await withFixture("tests/image-chat.html", async ({ cdp, evaluate }) => {
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="button-start-from-home"]'))`), "home screen");
  await evaluate(`(() => {
    const originalFetch = window.fetch.bind(window);
    window.__agentRequests = [];
    window.__agentAbortObserved = false;
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
        if (window.__agentRequests.length === 4) {
          const events = [
            { model: "qwen/qwen3.8-27b", agentProvider: "groq" },
            { notice: { id: "gemini-agent-qwen-fallback", message: "Gemini is rate-limited; Qwen is continuing.", model: "qwen/qwen3.8-27b" } },
            { agentTool: {
              tool: "run_code",
              callId: "qwen-browser-code",
              thoughtSignature: "groq-agent-v1",
              arguments: { language: "javascript", code: "console.log('qwen-run-ok')" },
              history: []
            } },
            { done: true }
          ];
          return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join(""), {
            headers: { "Content-Type": "text/event-stream" }
          });
        }
        if (window.__agentRequests.length === 6) {
          const events = [
            { agentTool: {
              tool: "run_code",
              callId: "html-preview-initial",
              thoughtSignature: "html-preview-signature",
              arguments: {
                language: "html",
                code: "<!doctype html><html><head><title>Agent preview</title></head><body><h1>First version</h1><script>throw new Error('HTML_PREVIEW_RUNTIME_FAILURE')</script></body></html>"
              },
              history: []
            } },
            { done: true }
          ];
          return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join(""), {
            headers: { "Content-Type": "text/event-stream" }
          });
        }
        if (window.__agentRequests.length === 7) {
          const history = window.__agentRequests.at(-1).body.agentHistory ?? [];
          window.__previewDiagnosticHistory = history;
          const events = [
            { agentTool: {
              tool: "run_code",
              callId: "html-preview-revision",
              thoughtSignature: "html-revision-signature",
              arguments: {
                language: "html",
                code: "<!doctype html><html><head><title>Corrected preview</title></head><body><h1>Corrected preview</h1></body></html>"
              },
              history
            } },
            { done: true }
          ];
          return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join(""), {
            headers: { "Content-Type": "text/event-stream" }
          });
        }
        if (window.__agentRequests.length === 9) {
          const events = [
            { model: "gemini-3.8-flash" },
            { activity: { id: "agent-finished", label: "Agent run was interrupted", kind: "info", status: "error" } },
            { error: "Nexo Agent could not complete this request. Please try again." }
          ];
          return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\\n\\n").join(""), {
            headers: { "Content-Type": "text/event-stream" }
          });
        }
        if (window.__agentRequests.length === 10) {
          return new Promise((_, reject) => {
            const abort = () => {
              window.__agentAbortObserved = true;
              reject(new DOMException("Request stopped", "AbortError"));
            };
            if (init.signal?.aborted) abort();
            else init.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        const events = [
          {
            content: window.__agentRequests.length === 5
              ? "Qwen Agent ran and checked its code."
              : window.__agentRequests.length === 8
                ? "The HTML preview was corrected using its browser runtime diagnostics."
                : "The isolated browser printed ${expectedOutput}."
          },
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
  const root = (await cdp("DOM.getDocument")).root.nodeId;
  const imageInput = (await cdp("DOM.querySelector", { nodeId: root, selector: '[data-testid="input-image-file"]' })).nodeId;
  assert.ok(imageInput);
  await cdp("DOM.setFileInputFiles", { nodeId: imageInput, files: [imagePath] });
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="image-attachment-preview"]'))`), "Agent image attachment");
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
  assert.equal(requests[0].body.image.mimeType, "image/png");
  assert.equal(requests[0].body.image.data, imageBase64);
  assert.equal(requests[0].body.agentHistory, undefined);
  assert.equal(requests[1].body.image.mimeType, "image/png", "the image remains available to Gemini after browser tool execution");
  assert.equal(requests[1].body.image.data, imageBase64);
  assert.equal(await evaluate(`Object.keys(localStorage).map(key => localStorage.getItem(key) || "").join("").includes(${JSON.stringify(imageBase64)})`), false);
  assert.equal(await evaluate(`document.body.textContent.includes("Image sent to Gemini. The image file is not saved in chat history.")`), true);
  await waitFor(() => evaluate(`!document.querySelector('[data-testid="image-attachment-preview"]')`), "sent Agent image preview cleared");
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

  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp("Input.insertText", { text: "Build and test a small JavaScript example." });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);
  await waitFor(() => evaluate(`window.__agentRequests.length === 5`), "Qwen Agent code continuation", 20000);
  await waitFor(() => evaluate(`document.body.textContent.includes("Qwen Agent ran and checked its code.")`), "Qwen Agent final answer", 20000);
  const qwenRequests = await evaluate(`window.__agentRequests.slice(3)`);
  assert.equal(qwenRequests[0].body.agentProvider, undefined, "new Agent tasks start with Gemini");
  assert.equal(qwenRequests[1].body.agentProvider, "groq", "the provider fallback persists for code execution follow-up");
  assert.equal(qwenRequests[1].body.agentHistory[0].callId, "qwen-browser-code");
  assert.match(qwenRequests[1].body.agentHistory[0].result, /qwen-run-ok/);

  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="button-send-message"]'))`), "composer after Qwen response");
  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp("Input.insertText", { text: "Build and preview a small HTML page, then fix its runtime error." });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);
  await waitFor(() => evaluate(`window.__agentRequests.length === 8`), "HTML preview diagnosis and revision", 30000);
  await waitFor(() => evaluate(`document.body.textContent.includes("The HTML preview was corrected using its browser runtime diagnostics.")`), "HTML preview final answer", 20000);
  const previewHistory = await evaluate(`window.__previewDiagnosticHistory`);
  assert.equal(previewHistory.length, 1);
  assert.match(previewHistory[0].result, /HTML_PREVIEW_RUNTIME_FAILURE/);
  assert.match(previewHistory[0].result, /Untrusted browser-generated preview diagnostics/);
  const htmlContinuation = await evaluate(`window.__agentRequests.slice(5)`);
  assert.equal(htmlContinuation[0].body.agentHistory, undefined);
  assert.match(htmlContinuation[1].body.agentHistory[0].result, /HTML_PREVIEW_RUNTIME_FAILURE/);
  assert.match(htmlContinuation[2].body.agentHistory[1].result, /no runtime errors were reported/);
  assert.equal(await evaluate(`document.querySelector('[data-testid="frame-preview"]').getAttribute("sandbox")`), "allow-scripts");
  assert.ok(await evaluate(`document.querySelector(".cm-content")?.textContent.includes("Corrected preview")`), "The revised HTML is shown in the workspace editor");

  await cdp("DOM.setFileInputFiles", { nodeId: imageInput, files: [imagePath] });
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="image-attachment-preview"]'))`), "image attachment for failed Agent request");
  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp("Input.insertText", { text: "Analyze this image after a provider failure." });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);
  await waitFor(() => evaluate(`window.__agentRequests.length === 9`), "failed image-bearing Agent request");
  await waitFor(() => evaluate(`document.body.textContent.includes("Nexo Agent could not complete this request. Please try again.")`), "safe Agent failure message");
  const failedImageRequest = await evaluate(`window.__agentRequests[8]`);
  assert.equal(failedImageRequest.body.image.data, imageBase64);
  await waitFor(() => evaluate(`Object.keys(localStorage).map(key => localStorage.getItem(key) || "").join("").includes("Analyze this image after a provider failure.")`), "failed image request saved to chat");
  await delay(600);
  assert.equal(await evaluate(`Object.keys(localStorage).map(key => localStorage.getItem(key) || "").join("").includes(${JSON.stringify(imageBase64)})`), false, "image bytes are absent from saved chat state after failure");

  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="button-send-message"]'))`), "composer after failed Agent request");
  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp("Input.insertText", { text: "Stop this image-bearing request." });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);
  await waitFor(() => evaluate(`window.__agentRequests.length === 10`), "image-bearing request to cancel");
  assert.equal((await evaluate(`window.__agentRequests[9]`)).body.image.data, imageBase64);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="button-stop-response"]'))`), "Agent stop control");
  await evaluate(`document.querySelector('[data-testid="button-stop-response"]').click()`);
  await waitFor(() => evaluate(`window.__agentAbortObserved`), "browser abort signal on cancelled Agent request");
  assert.equal(await evaluate(`Object.keys(localStorage).map(key => localStorage.getItem(key) || "").join("").includes(${JSON.stringify(imageBase64)})`), false, "image bytes remain absent from saved chat state after cancellation");

  console.log(liveTool
    ? "Live Agent browser check passed: image upload, Gemini-generated code execution, and continuation result."
    : "Agent browser checks passed: image upload, Agent routing, isolated code execution, HTML preview diagnostics and revision, provider failure and cancellation, continuation result, workspace output, and activity panel.");
  await delay(50);
});
} finally {
  await rm(temp, { recursive: true, force: true });
}
