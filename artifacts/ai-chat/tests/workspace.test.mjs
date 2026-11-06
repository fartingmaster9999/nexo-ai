import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { copyRawCode, rawCodeFromSource } from '../src/lib/code-clipboard.ts';
import { workspaceBounds, clampWorkspaceWidth } from '../src/lib/workspace-size.ts';
import { loadEditorLanguage } from '../src/lib/editor-language.ts';

test('clipboard receives exact raw bytes and does not succeed before write resolves', async () => {
  const code = '\tprint("✓")  \r\n\n';
  let received, resolveWrite, completed = false;
  const write = copyRawCode(code, { writeText: (value) => {
    received = value;
    return new Promise((resolve) => { resolveWrite = resolve; });
  } }).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(received, code);
  assert.equal(completed, false);
  resolveWrite();
  await write;
  assert.equal(completed, true);
});

test('clipboard denial and unavailable APIs are explicit failures', async () => {
  await assert.rejects(copyRawCode('x', {}), /unavailable.*manually/);
  await assert.rejects(copyRawCode('x', { writeText: async () => { throw new Error('denied'); } }), /failed.*manually/);
});

test('fenced code keeps indentation, CRLF, blank lines and unknown language bytes', () => {
  for (const [source, expected] of [
    ['```python\n\tprint("hi")  \n\n```', '\tprint("hi")  \n\n'],
    ['```python\nprint(r"$x^2$ and \\(literal\\)")\n```', 'print(r"$x^2$ and \\(literal\\)")\n'],
    ['~~~rust\r\n  let x = 2;\r\n~~~', '  let x = 2;\r\n'],
    ['```\nx\n```', 'x\n'],
    ['```js\npartial', 'partial'],
    ['  ```python\n    print(1)\n  ```', '  print(1)\n'],
  ]) assert.equal(rawCodeFromSource(source, 0, source.length, 'fallback'), expected);
  assert.equal(rawCodeFromSource('> ```\n> x\n> ```', 0, 16, 'x\n'), 'x\n');
});

test('workspace bounds preserve readable chat and adapt to tablet/mobile', () => {
  assert.deepEqual(workspaceBounds(1440, 260), { min: 320, max: 844 });
  assert.deepEqual(workspaceBounds(900, 260), { min: 320, max: 852 });
  assert.deepEqual(workspaceBounds(390), { min: 390, max: 390 });
  assert.equal(clampWorkspaceWidth(3000, workspaceBounds(1440, 420)), 684);
  assert.equal(clampWorkspaceWidth(-1, workspaceBounds(1440)), 320);
});

test('editor modes are selected dynamically and repeated loads share a promise', async () => {
  const first = loadEditorLanguage('python');
  assert.equal(first, loadEditorLanguage('python'));
  assert.equal((await first).language.name, 'python');
  assert.equal((await loadEditorLanguage('javascript')).language.name, 'javascript');
  assert.equal((await loadEditorLanguage('html')).language.name, 'html');
});

test('Python worker loads imports only, without preloading scientific libraries', async () => {
  const html = await readFile(new URL('../public/code-runner.html', import.meta.url), 'utf8');
  const source = html.match(/<script id="worker-source" type="text\/plain">([\s\S]*?)<\/script>/)[1];
  const imports = [], scripts = [], executed = [], messages = [];
  const context = vm.createContext({
    importScripts: (url) => scripts.push(url),
    postMessage: (message) => messages.push(message),
    loadPyodide: async () => ({
      setStdout() {}, setStderr() {}, globals: { set() {} },
      loadPackage: () => assert.fail('Unconditional packages must not load'),
      loadPackagesFromImports: async (code) => imports.push(code),
      runPythonAsync: async (code) => { executed.push(code); },
    }),
  });
  context.self = context;
  vm.runInContext(source, context);
  for (const code of ['print(5)', 'import numpy as np\nprint(np.arange(3))', 'import matplotlib.pyplot as plt\nplt.plot([1,2])']) {
    await context.onmessage({ data: { language: 'python', code } });
    assert.equal(imports.at(-1), code);
  }
  assert.equal(scripts.length, 3);
  assert.ok(scripts.every((url) => url.includes('pyodide') && !url.includes('lodash')));
  assert.equal(messages.filter((message) => message.type === 'done' && !message.error).length, 3);
  assert.match(executed[0], /MPLBACKEND/);
  assert.ok(!executed.some((code) => /^import numpy|^import scipy|^import matplotlib/.test(code) && !imports.includes(code)));
  assert.ok(executed.some((code) => code.includes('modules.get("matplotlib.pyplot")')));
});
