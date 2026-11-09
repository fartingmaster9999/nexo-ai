import assert from 'node:assert/strict';
import { delay, waitFor, withFixture } from './browser-harness.mjs';

// Use the real App with deterministic provider responses; no live inference/billing.
await withFixture('tests/image-chat.html', async ({ cdp, evaluate, navigate }) => {
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.endsWith('/api/agent')) return original(input, init);
      const body = JSON.parse(init.body);
      const requests = JSON.parse(localStorage.getItem('test-requests') || '[]');
      requests.push(body);
      localStorage.setItem('test-requests', JSON.stringify(requests));
      const scenario = localStorage.getItem('test-scenario');
      const sse = events => new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
      if (scenario === 'wait') {
        return sse([{ model: 'qwen', agentProvider: 'groq', agentTask: 'coding' },
          { agentRetry: { afterMs: 30000, history: body.agentHistory || [] } }, { done: true }]);
      }
      if (scenario === 'write' && !body.agentHistory?.length && !body.agentReview) {
        return sse([{ model: 'qwen', agentProvider: 'groq', agentTask: 'coding' }, { agentTool: {
          tool: 'write_project', callId: 'write-once', thoughtSignature: 'signature', history: [],
          arguments: { entrypoint: 'index.html', files: [{ path: 'index.html', content: '<h1>Saved once</h1>' }] }
        } }, { done: true }]);
      }
      if (scenario === 'tool' && !body.agentHistory?.length && !body.agentReview) {
        return sse([{ model: 'qwen', agentProvider: 'groq', agentTask: 'coding' }, { agentTool: {
          tool: 'run_code', callId: 'run-once', thoughtSignature: 'signature', history: [],
          arguments: { language: 'javascript', code: "console.log('completed-before-reload')" }
        } }, { done: true }]);
      }
      if (['tool', 'write'].includes(scenario) && body.agentReview) {
        return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      }
      return sse([{ content: 'Recovered build complete.' }, { done: true }]);
    };
  })();` });
  await navigate();
  const findCheckpoint = `(() => { const key = Object.keys(localStorage).find(key => key.startsWith('nexo-agent-continuation:')); return key ? JSON.parse(localStorage.getItem(key)) : null; })()`;
  const requests = () => evaluate(`JSON.parse(localStorage.getItem('test-requests') || '[]')`);
  async function openSaved(id) {
    await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="button-start-from-home"]'))`), 'home after reload');
    await evaluate(`document.querySelector('[data-testid="button-start-from-home"]').click()`);
    await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="conversation-${id}"]'))`), 'saved conversation');
    await evaluate(`document.querySelector('[data-testid="select-conversation-${id}"]').click()`);
    await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="agent-recovery"]'))`), 'explicit recovery notice');
  }
  async function send(text) {
    await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
    await cdp('Input.insertText', { text });
    await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);
  }

  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="button-start-from-home"]'))`), 'home');
  await evaluate(`localStorage.setItem('test-scenario', 'wait'); document.querySelector('[data-testid="button-start-from-home"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-testid="toggle-agent"]'))`), 'composer');
  await evaluate(`document.querySelector('[data-testid="toggle-agent"]').click()`);
  await send('Build with a provider wait');
  await waitFor(() => evaluate(`(${findCheckpoint})?.phase === 'waiting'`), 'checkpoint before provider wait');
  const waiting = await evaluate(findCheckpoint);
  assert.equal(waiting.retries, 1);
  await cdp('Page.reload');
  await openSaved(waiting.conversationId);
  const recoveryText = await evaluate(`document.querySelector('[data-testid="agent-recovery"]')?.textContent || ''`);
  assert.match(recoveryText, /saved files and completed steps are safe/i);
  assert.match(recoveryText, /completed steps will not be repeated/i);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="button-resume-agent"]'))`), true, 'a resumable checkpoint must offer an explicit resume action');
  await delay(400);
  assert.equal((await requests()).length, 1, 'reload and selection must not request inference');
  assert.equal(await evaluate(`document.querySelectorAll('iframe').length`), 0, 'reload must not execute a preview');
  // Leave a bounded window so the resume click must still wait before requesting.
  await evaluate(`(() => { const key = 'nexo-agent-continuation:' + encodeURIComponent(${JSON.stringify(waiting.conversationId)}); const c = JSON.parse(localStorage.getItem(key)); c.waitUntil = Date.now() + 1200; localStorage.setItem(key, JSON.stringify(c)); localStorage.setItem('test-scenario', 'finish'); })()`);
  await evaluate(`document.querySelector('[data-testid="button-resume-agent"]').click()`);
  await delay(200);
  assert.equal((await requests()).length, 1, 'explicit resume respects remaining wait');
  await waitFor(async () => (await requests()).length === 2, 'resumed provider request');
  await waitFor(() => evaluate(`document.body.textContent.includes('Recovered build complete.')`), 'completed resumed response');
  assert.equal((await requests())[1].agentRetryCount, 1);
  await waitFor(() => evaluate(`!(${findCheckpoint})`), 'completed checkpoint cleanup');

  // Start a separate request, complete the real browser runner, reload during its optional review.
  await evaluate(`document.querySelector('[data-testid="button-close-workspace"]')?.click()`);
  await evaluate(`localStorage.setItem('test-scenario', 'tool')`);
  await send('Run a tool then recover it');
  await waitFor(() => evaluate(`(${findCheckpoint})?.history?.at(-1)?.result.includes('stdout: completed-before-reload')`), 'completed tool result saved before review', 25000);
  const completed = await evaluate(findCheckpoint);
  const count = (await requests()).length;
  await cdp('Page.reload');
  await openSaved(completed.conversationId);
  await delay(300);
  assert.equal((await requests()).length, count, 'completed code must not rerun or request on reload');
  await evaluate(`localStorage.setItem('test-scenario', 'finish'); document.querySelector('[data-testid="button-resume-agent"]').click()`);
  await waitFor(async () => (await requests()).length === count + 1, 'continuation carrying completed output');
  const continued = (await requests()).at(-1);
  assert.equal(continued.agentHistory.at(-1).callId, 'run-once');
  assert.match(continued.agentHistory.at(-1).result, /stdout: completed-before-reload/);
  await waitFor(() => evaluate(`!(${findCheckpoint})`), 'tool build completion');

  // Corrupt and future-version records never expose a resume action or change history.
  await evaluate(`document.querySelector('[data-testid="button-close-workspace"]')?.click()`);
  for (const raw of ['{bad', '{"version":999}']) {
    await evaluate(`localStorage.setItem('nexo-agent-continuation:' + encodeURIComponent(${JSON.stringify(completed.conversationId)}), ${JSON.stringify(raw)})`);
    await cdp('Page.reload');
    await openSaved(completed.conversationId);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="button-resume-agent"]'))`), false);
    assert.equal((await requests()).length, count + 1);
    await evaluate(`document.querySelector('[data-testid="button-dismiss-recovery"]').click()`);
  }

  // Stop persists an explicit cancellation and is not offered as resumable after reload.
  await evaluate(`localStorage.setItem('test-scenario', 'wait')`);
  await send('Cancel this build');
  await waitFor(() => evaluate(`(${findCheckpoint})?.phase === 'waiting'`), 'cancellable wait');
  const cancelled = await evaluate(findCheckpoint);
  await evaluate(`document.querySelector('[data-testid="button-stop-response"]').click()`);
  await waitFor(() => evaluate(`(${findCheckpoint})?.phase === 'cancelled'`), 'saved cancellation');
  const stoppedCount = (await requests()).length;
  await cdp('Page.reload');
  await openSaved(cancelled.conversationId);
  assert.equal(await evaluate(`Boolean(document.querySelector('[data-testid="button-resume-agent"]'))`), false);
  assert.equal((await requests()).length, stoppedCount);
  await evaluate(`document.querySelector('[data-testid="button-dismiss-recovery"]').click()`);

  // A saved file update is not replayed on reload or resume, and opt-outs survive.
  await evaluate(`localStorage.setItem('test-scenario', 'write')`);
  await send('Write an app once');
  await waitFor(() => evaluate(`(${findCheckpoint})?.history?.at(-1)?.tool === 'write_project' && (${findCheckpoint})?.phase === 'ready'`), 'saved project tool result', 25000);
  const written = await evaluate(findCheckpoint);
  await evaluate(`(() => {
    const key = 'nexo-project-v1:' + encodeURIComponent(${JSON.stringify(written.conversationId)});
    const p = JSON.parse(localStorage.getItem(key));
    p.files[0].content = '<h1>Manual edit after the write</h1>';
    p.selectedPaths = [];
    localStorage.setItem(key, JSON.stringify(p));
  })()`);
  const projectKey = `nexo-project-v1:${encodeURIComponent(written.conversationId)}`;
  const manuallyEditedBeforeReload = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(projectKey)})).files[0].content`);
  assert.equal(manuallyEditedBeforeReload, '<h1>Manual edit after the write</h1>', 'manual project edits must be saved before reload');
  await delay(100);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(projectKey)})).files[0].content`), '<h1>Manual edit after the write</h1>', 'the active app must not overwrite a newer saved project');
  const writeCount = (await requests()).length;
  await cdp('Page.reload');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(projectKey)})).files[0].content`), '<h1>Manual edit after the write</h1>', 'a page reload must not revert project files');
  await openSaved(written.conversationId);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(projectKey)})).files[0].content`), '<h1>Manual edit after the write</h1>', 'reload must preserve manual project edits');
  assert.equal((await requests()).length, writeCount);
  await evaluate(`localStorage.setItem('test-scenario', 'finish'); document.querySelector('[data-testid="button-resume-agent"]').click()`);
  await waitFor(async () => (await requests()).length === writeCount + 1, 'write continuation');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(projectKey)})).files[0].content`), '<h1>Manual edit after the write</h1>', 'resume must preserve manual project edits');
  const writeContinuation = (await requests()).at(-1);
  assert.equal(writeContinuation.agentHistory.at(-1).callId, 'write-once');
  assert.equal(writeContinuation.agentHistory.at(-1).arguments.files[0].content, '', 'historical source respects deselection');
  assert.equal(writeContinuation.projectFiles, undefined);
  const savedProject = await evaluate(`JSON.parse(localStorage.getItem('nexo-project-v1:' + encodeURIComponent(${JSON.stringify(written.conversationId)})))`);
  assert.equal(savedProject.files[0].content, '<h1>Manual edit after the write</h1>');
  assert.deepEqual(savedProject.selectedPaths, []);
  console.log('PASS: provider wait and completed tool reload; explicit resume; no automatic execution or write replay; source privacy; cancellation; corrupt/versioned records.');
});
