import assert from 'node:assert/strict';
import { waitFor, withFixture } from './browser-harness.mjs';

await withFixture('tests/image-chat.html', async ({ cdp, evaluate }) => {
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="button-start-from-home"]'))`), 'home screen');
  await evaluate(`(() => {
    window.__parallelCodingRequests = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.endsWith('/api/agent')) return originalFetch(input, init);
      const body = JSON.parse(init.body);
      if (body.agentReview) {
        const events = [{ content: 'Independent review completed.' }, { done: true }];
        return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join(''), {
          headers: { 'Content-Type': 'text/event-stream' }
        });
      }
      window.__parallelCodingRequests.push(body);
      const events = window.__parallelCodingRequests.length === 1
        ? [
            { model: 'qwen/qwen3.8-27b', agentProvider: 'groq', agentTask: 'coding' },
            { agentTool: {
              tool: 'run_code',
              callId: 'single-model-browser-run',
              thoughtSignature: 'single-model-browser-signature',
              arguments: { language: 'javascript', code: 'console.log(42)' },
              history: []
            } },
            { done: true }
          ]
        : [{ content: 'The single-model build continued without another candidate.' }, { done: true }];
      return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join(''), {
        headers: { 'Content-Type': 'text/event-stream' }
      });
    };
  })()`);

  await evaluate(`document.querySelector('[data-testid="button-start-from-home"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="toggle-agent"]'))`), 'Agent toggle');
  await evaluate(`document.querySelector('[data-testid="button-home-agent-settings"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="switch-parallel-coding"]'))`), 'Agent settings');
  await evaluate(`(() => {
    const toggle = document.querySelector('[data-testid="switch-parallel-coding"]');
    if (toggle.getAttribute('aria-checked') !== 'false') toggle.click();
  })()`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="switch-parallel-coding"]').getAttribute('aria-checked')`), 'false');
  assert.equal(await evaluate(`localStorage.getItem('nexo-parallel-coding')`), '0');
  await evaluate(`document.querySelector('[data-testid="button-close-agent-settings"]').click()`);
  await evaluate(`document.querySelector('[data-testid="toggle-agent"]').click()`);
  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp('Input.insertText', { text: 'Build a small JavaScript example.' });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);

  await waitFor(() => evaluate(`window.__parallelCodingRequests.length === 2`), 'initial coding request and tool continuation');
  await waitFor(
    () => evaluate(`document.body.textContent.includes('The single-model build continued without another candidate.')`),
    'continued Agent answer',
  );
  const requests = await evaluate(`window.__parallelCodingRequests`);
  assert.equal(requests[0].parallelCoding, false, 'new coding requests send the saved single-model setting');
  assert.equal(requests[1].parallelCoding, undefined, 'tool continuations do not restart parallel coding');
  assert.equal(requests[1].agentHistory[0].callId, 'single-model-browser-run');
  assert.equal(await evaluate(`localStorage.getItem('nexo-parallel-coding')`), '0', 'the preference remains saved after the request');
});
