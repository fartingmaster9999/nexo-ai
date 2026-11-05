import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function waitFor(check, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(`Timed out: ${label}`);
}
const port = await freePort(), debugPort = await freePort();
const profile = await mkdtemp(path.join(tmpdir(), 'nexo-workspace-'));
const vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: packageDir, env: { ...process.env, PORT: String(port), BASE_PATH: '/' }, stdio: 'ignore',
});
const browser = spawn(process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let socket, sequence = 0;
const pending = new Map(), requests = [];
function cdp(method, params = {}, timeout = 15000) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, timeout) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result?.value;
}
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const width = () => evaluate(`document.querySelector('[data-testid="panel-workspace"]').getBoundingClientRect().width`);
const changeLanguage = (language) => evaluate(`(() => {
  const select = document.querySelector('[data-testid="select-language"]');
  select.value = ${JSON.stringify(language)};
  select.dispatchEvent(new Event('change', {bubbles:true}));
})()`);
async function dragDivider(kind, delta) {
  const rect = await evaluate(`(() => { const r = document.querySelector('[data-testid="separator-workspace"]').getBoundingClientRect(); return {x:r.x+5,y:200}; })()`);
  if (kind === 'touch') {
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x - delta, y: rect.y }] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  } else {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x - delta, y: rect.y, button: 'left', buttons: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x - delta, y: rect.y, button: 'left' });
  }
  await delay(100);
}
try {
  await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${port}/tests/workspace.html`)).ok; } catch { return false; } }, 'Vite');
  let target;
  await waitFor(async () => {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((item) => item.type === 'page'); return !!target; } catch { return false; }
  }, 'Chromium');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (!message.id) return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
  });
  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/tests/workspace.html` });
  await waitFor(() => evaluate(`!!window.__workspaceFixture && document.querySelectorAll('.code-block').length === 2`), 'Markdown');
  assert.ok(!requests.some((url) => /codemirror_lang-(python|javascript|html)/.test(url)), 'No grammar before workspace is opened');
  await evaluate(`window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText:async text=>window.__copied.push(text)} });`);
  await click('.code-block button');
  await waitFor(() => evaluate(`window.__copied.length === 1`), 'raw copy');
  assert.equal(await evaluate('window.__copied[0]'), '\tprint("hello ✓")  \r\n\r\n');
  await evaluate(`navigator.clipboard.writeText = async()=>{throw new Error('denied')}`);
  await click('.code-block:nth-of-type(2) button');
  await waitFor(() => evaluate(`document.querySelector('.code-copy-error')?.textContent.includes('manually')`), 'denied feedback');
  await evaluate(`navigator.clipboard.writeText = async text=>window.__copied.push(text); window.__workspaceFixture.open(true);`);
  await waitFor(() => evaluate(`!!document.querySelector('.cm-content') && !document.querySelector('.ws-language-status')`), 'Python highlighting');
  assert.ok(requests.some((url) => /codemirror_lang-python/.test(url)));
  assert.ok(!requests.some((url) => /codemirror_lang-(javascript|html)/.test(url)), 'Python does not download other grammars');
  const original = await width();
  await dragDivider('mouse', 80);
  assert.ok(await width() >= original + 70, 'Pointer resize');
  const afterMouse = await width();
  await dragDivider('touch', 40);
  assert.ok(await width() >= afterMouse + 30, 'Touch resize');
  await evaluate(`document.querySelector('[data-testid="separator-workspace"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
  assert.equal(await width(), 320);
  await evaluate(`document.querySelector('[data-testid="separator-workspace"]').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  const expanded = await width();
  assert.ok(expanded <= 1104);
  await delay(300);
  await evaluate(`document.querySelector('.cm-content').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await cdp('Input.insertText', { text: 'print("edited")\n' });
  await click('[aria-label="Copy workspace code"]');
  await waitFor(() => evaluate(`window.__copied.at(-1) === 'print("edited")\\n'`), 'edited code copy');
  await evaluate(`window.__workspaceFixture.generated('python','print("new generated version")')`);
  await delay(100);
  assert.ok(await evaluate(`document.querySelector('.cm-content').textContent.includes('edited')`), 'Generated updates preserve edits');
  await changeLanguage('javascript');
  await changeLanguage('html');
  await waitFor(() => evaluate(`!document.querySelector('.ws-language-status') && document.querySelector('select').value === 'html'`), 'rapid mode switch');
  assert.ok(requests.some((url) => /codemirror_lang-html/.test(url)));
  await click('[data-testid="button-close-workspace"]');
  await evaluate(`window.__workspaceFixture.open(true)`);
  await waitFor(() => evaluate(`!!document.querySelector('.cm-content')`), 'workspace reopen');
  assert.equal(await width(), expanded, 'Saved width survives remount');
  assert.ok(await evaluate(`document.querySelector('.cm-content').textContent.includes('edited')`), 'Edited draft survives remount');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: true });
  await waitFor(async () => await width() === 390, 'phone width');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.workspace-resizer')).display`), 'none');
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'No phone overflow');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const runPython = (code) => evaluate(`window.__workspaceFixture.execute({language:'python', code:${JSON.stringify(code)}})`, 120000);
  const plain = await runPython('import sys\nprint("simple:", 2+3)\nprint("scientific:", any(name in sys.modules for name in ("numpy","scipy","matplotlib")))');
  assert.ok(!plain.error, plain.error);
  assert.ok(plain.outputs.some((item) => item.text === 'scientific: False'));
  const scientific = await runPython('import numpy as np\nfrom scipy.special import factorial\nprint("numerics:", int(np.arange(5).sum()), factorial(5, exact=True))');
  assert.ok(!scientific.error, scientific.error);
  assert.ok(scientific.outputs.some((item) => item.text === 'numerics: 10 120'));
  const plot = await runPython('import matplotlib.pyplot as plt\nplt.plot([0,1],[0,1])\nprint("plot ready")');
  assert.ok(!plot.error, plot.error);
  assert.ok(plot.outputs.some((item) => item.kind === 'image' && item.dataUrl?.startsWith('data:image/png;base64,')), 'Conditional plot capture');
  const cancelled = await evaluate(`(async()=>{ const ctrl=new AbortController(); setTimeout(()=>ctrl.abort(),50); try { await window.__workspaceFixture.execute({language:'python',code:'while True: pass',signal:ctrl.signal}); return false; } catch(error) { return error.name==='AbortError' && !document.querySelector('iframe[hidden]'); } })()`);
  assert.equal(cancelled, true);
  console.log('Workspace browser checks passed: raw/edited copy, denial, mouse/touch/keyboard sizing, drafts, lazy modes, mobile, plain Python, NumPy/SciPy, plots and cancellation.');
} finally {
  socket?.close();
  for (const child of [browser, vite]) child.kill('SIGTERM');
  await delay(500);
  for (const child of [browser, vite]) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true });
}
