import assert from 'node:assert/strict';
import { waitFor, withFixture } from './browser-harness.mjs';

const working = '<!doctype html><html><body><h1>Verified original</h1></body></html>';
const failing = '<!doctype html><html><body><h1>Runtime failure</h1><script>throw new Error("candidate runtime failure")</script></body></html>';
const passing = `<!doctype html><html><body><h1>Winning revision</h1><button id="add">Add</button><output id="count">0</output>
<script>document.querySelector('#add').onclick=()=>{document.querySelector('#count').textContent='1';parent.postMessage({type:'parallel-candidate-action'},'*')}</script>
<script id="nexo-interaction-checks" type="application/json">{"steps":[{"action":"click","selector":"#add"},{"action":"assertText","selector":"#count","value":"1"}]}</script></body></html>`;

await withFixture('tests/image-chat.html', async ({ cdp, evaluate, navigate }) => {
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const originalFetch = window.fetch.bind(window);
    window.__parallelCandidateActions = 0;
    window.addEventListener('message', event => {
      if (event.data?.type === 'parallel-candidate-action') window.__parallelCandidateActions++;
    });
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.endsWith('/api/agent')) return originalFetch(input, init);
      const body = JSON.parse(init.body);
      const sse = events => new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join(''), {headers:{'Content-Type':'text/event-stream'}});
      if (body.agentReview) return sse([{content:'The sandbox results were reviewed.'},{done:true}]);
      if (!(body.agentHistory || []).length) {
        const candidates = [
          {model:'qwen-runtime',tool:'write_project',callId:'runtime-failing',thoughtSignature:'runtime-signature',
            arguments:{entrypoint:'index.html',files:[{path:'index.html',content:${JSON.stringify(failing)}}]}},
          {model:'gpt-interactions',tool:'write_project',callId:'interaction-passing',thoughtSignature:'interaction-signature',
            arguments:{entrypoint:'index.html',files:[{path:'index.html',content:${JSON.stringify(passing)}}]}}
        ];
        return sse([{model:'qwen-runtime',agentProvider:'groq',agentTask:'coding'},
          {agentTool:{...candidates[0],history:[],candidates}},{done:true}]);
      }
      return sse([{content:'The browser-tested revision is saved.'},{done:true}]);
    };
  })();` });
  await evaluate(`(() => {
    const now = Date.now();
    localStorage.setItem('still-chat-conversations-v1', JSON.stringify([{id:'parallel-candidate-chat',title:'Candidate checks',createdAt:now,updatedAt:now,messages:[{id:'user-original',role:'user',content:'Build an app'},{id:'reply-original',role:'assistant',content:'Original built.',agentMode:true}]}]));
    localStorage.setItem('nexo-project-v1:parallel-candidate-chat', JSON.stringify({files:[{path:'index.html',content:${JSON.stringify(working)}}],entrypoint:'index.html',selectedPaths:['index.html']}));
    localStorage.setItem('nexo-agent','1');
  })()`);
  await navigate();
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="button-start-from-home"]')`), 'home');
  await evaluate(`document.querySelector('[data-testid="button-start-from-home"]').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="select-conversation-parallel-candidate-chat"]')`), 'saved conversation');
  await evaluate(`document.querySelector('[data-testid="select-conversation-parallel-candidate-chat"]').click()`);
  await evaluate(`document.querySelector('[data-testid="input-message"]').focus()`);
  await cdp('Input.insertText', { text: 'Revise the existing app.' });
  await evaluate(`document.querySelector('[data-testid="button-send-message"]').click()`);

  await waitFor(() => evaluate(`window.__parallelCandidateActions === 1`), 'the passing candidate interaction check');
  assert.equal(
    await evaluate(`JSON.parse(localStorage.getItem('nexo-project-v1:parallel-candidate-chat')).files[0].content`),
    working,
    'candidate checks do not overwrite the saved project before selection',
  );
  assert.equal(
    await evaluate(`Array.from(document.querySelectorAll('iframe')).some(frame => frame.title === 'Isolated HTML preview' && frame.srcdoc.includes('Verified original'))`),
    true,
    'the prior preview remains visible while both drafts are checked',
  );
  await waitFor(
    () => evaluate(`JSON.parse(localStorage.getItem('nexo-project-v1:parallel-candidate-chat')).files[0].content.includes('Winning revision')`),
    'the candidate with passing browser checks is promoted',
  );
  await waitFor(() => evaluate(`!localStorage.getItem('nexo-agent-continuation:parallel-candidate-chat')`), 'Agent completion');
  assert.equal(await evaluate(`Number(window.__parallelCandidateActions)`), 1, 'the selected interaction check is not replayed');
  assert.equal(
    await evaluate(`JSON.parse(localStorage.getItem('nexo-project-v1:parallel-candidate-chat')).files[0].content`),
    passing,
  );
  console.log('PASS: both candidates were isolated; the passing interaction candidate was promoted without replay.');
});
