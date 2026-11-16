import assert from 'node:assert/strict';
import { withFixture, waitFor } from './browser-harness.mjs';

const working = '<!doctype html><html><body><h1>Verified original</h1></body></html>';
const runtimeFailure = '<!doctype html><html><body><h1>Runtime candidate</h1><script>throw new Error("candidate-runtime-failure")</script></body></html>';
const page = repaired => `<!doctype html><html><body><h1>Counter revision</h1><button id="add">Add</button><output id="count">0</output>
<script>document.querySelector('#add').onclick=()=>{parent.postMessage({type:'test-candidate-action'},'*');${repaired ? "document.querySelector('#count').textContent='1';" : ''}}</script>
<script id="nexo-interaction-checks" type="application/json">{"steps":[{"action":"click","selector":"#add"},{"action":"assertText","selector":"#count","value":"1"}]}</script></body></html>`;

// Exercise the real controller, storage, and opaque-origin frames with no paid inference.
await withFixture('tests/image-chat.html', async ({ cdp, evaluate, navigate }) => {
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const originalFetch = window.fetch.bind(window);
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'nexo-project-v1:candidate-chat') {
        originalSet.call(this, 'test-promotions', String(Number(this.getItem('test-promotions') || 0) + 1));
      }
      return originalSet.call(this, key, value);
    };
    window.addEventListener('message', event => {
      if (event.data?.type === 'test-candidate-action') localStorage.setItem('test-actions', String(Number(localStorage.getItem('test-actions') || 0) + 1));
    });
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.endsWith('/api/agent')) return originalFetch(input, init);
      const body = JSON.parse(init.body);
      const sse = events => new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join(''), {headers:{'Content-Type':'text/event-stream'}});
      if (body.agentReview) return sse([{content:'Use the deterministic browser results.'},{done:true}]);
      const requests = JSON.parse(localStorage.getItem('test-requests') || '[]');
      requests.push(body); localStorage.setItem('test-requests', JSON.stringify(requests));
      const history = body.agentHistory || [];
      const tool = (id, source, runCode = false) => sse([{agentProvider:'groq',model:'qwen',agentTask:'coding'},
        {agentTool:{tool:runCode?'run_code':'write_project',callId:id,thoughtSignature:'signature',history,
          arguments:runCode?{language:'html',code:source}:{entrypoint:'index.html',files:[{path:'index.html',content:source}]}}},{done:true}]);
      if (!history.length) return tool('runtime-candidate', ${JSON.stringify(runtimeFailure)});
      if (history.length === 1 && !localStorage.getItem('test-resumed')) return new Promise(() => {});
      if (history.length === 1) return tool('interaction-candidate', ${JSON.stringify(page(false))});
      if (history.length === 2) return new Promise(resolve => { window.releaseRepair = () => resolve(tool('repaired-candidate', ${JSON.stringify(page(true))}, true)); });
      return sse([{content:'The checked revision is saved.'},{done:true}]);
    };
  })();` });
  await evaluate(`(() => {
    const now = Date.now();
    localStorage.setItem('still-chat-conversations-v1', JSON.stringify([{id:'candidate-chat',title:'Candidate safety',createdAt:now,updatedAt:now,messages:[{id:'user-original',role:'user',content:'Build an app'},{id:'reply-original',role:'assistant',content:'Original built.',agentMode:true}]}]));
    localStorage.setItem('nexo-project-v1:candidate-chat', JSON.stringify({files:[{path:'index.html',content:${JSON.stringify(working)}}],entrypoint:'index.html',selectedPaths:['index.html']}));
    localStorage.setItem('nexo-agent','1');
  })()`);
  await navigate();
  async function openSaved() {
    await waitFor(() => evaluate(`!!document.querySelector('[data-testid="button-start-from-home"]')`), 'home');
    await evaluate(`document.querySelector('[data-testid="button-start-from-home"]').click()`);
    await waitFor(() => evaluate(`!!document.querySelector('[data-testid="select-conversation-candidate-chat"]')`), 'saved conversation');
    await evaluate(`document.querySelector('[data-testid="select-conversation-candidate-chat"]').click()`);
  }
  await openSaved();
  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp('Input.insertText', { text: 'Revise the existing app.' });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);
  await waitFor(() => evaluate(`JSON.parse(localStorage.getItem('test-requests') || '[]').some(r => r.agentHistory?.length === 1)`), 'runtime failure returned to Agent');
  const source = () => evaluate(`JSON.parse(localStorage.getItem('nexo-project-v1:candidate-chat')).files[0].content`);
  const visiblePreview = () => evaluate(`Array.from(document.querySelectorAll('iframe')).some(frame => frame.title !== 'Hidden isolated Agent candidate test' && frame.srcdoc.includes('Verified original'))`);
  assert.equal(await source(), working);
  assert.equal(await visiblePreview(), true, 'saved working preview remains available during repair');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('nexo-agent-candidate-v1:candidate-chat')).files[0].content`), runtimeFailure);
  await navigate();
  await openSaved();
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="button-resume-agent"]')`), 'resume after failed candidate');
  await evaluate(`localStorage.setItem('test-resumed','1'); document.querySelector('[data-testid="button-resume-agent"]').click()`);
  await waitFor(() => evaluate(`typeof window.releaseRepair === 'function'`), 'interaction failure returned to Agent');
  const requests = await evaluate(`JSON.parse(localStorage.getItem('test-requests'))`);
  assert.equal(requests.at(-2).projectFiles[0].content, runtimeFailure, 'recovery supplies candidate source, not stale working files');
  assert.match(requests.at(-2).agentHistory[0].result, /candidate-runtime-failure/);
  assert.match(requests.at(-1).agentHistory[1].result, /failed|text-mismatch/);
  assert.equal(await source(), working);
  assert.equal(await visiblePreview(), true);
  assert.equal(await evaluate(`Number(localStorage.getItem('test-actions'))`), 1, 'the failed interaction ran once and was not replayed by recovery');
  await evaluate(`window.releaseRepair()`);
  await waitFor(() => evaluate(`JSON.parse(localStorage.getItem('nexo-project-v1:candidate-chat')).files[0].content.includes("textContent='1'")`), 'successful candidate promoted');
  await waitFor(() => evaluate(`!localStorage.getItem('nexo-agent-continuation:candidate-chat')`), 'build completed');
  assert.equal(await source(), page(true));
  assert.equal(await evaluate(`localStorage.getItem('nexo-agent-candidate-v1:candidate-chat')`), null);
  assert.equal(await evaluate(`Number(localStorage.getItem('test-promotions'))`), 1);
  assert.equal(await evaluate(`Number(localStorage.getItem('test-actions'))`), 2, 'promotion does not replay candidate test actions');
  await navigate();
  await openSaved();
  assert.equal(await source(), page(true), 'promoted source persists after reload');
  assert.equal(await evaluate(`Number(localStorage.getItem('test-actions'))`), 2);
  console.log('PASS: runtime/interaction failures retained working preview; candidate recovered; repair promoted once without replay.');
});
