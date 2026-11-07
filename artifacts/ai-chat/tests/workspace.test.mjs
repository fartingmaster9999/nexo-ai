import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { copyRawCode, rawCodeFromSource } from '../src/lib/code-clipboard.ts';
import { makePreviewHtml, sanitizePreviewDiagnostic } from '../src/lib/code-runner.ts';
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

test('HTML preview is instrumented, network-restricted, and diagnostics are bounded', () => {
  const preview = makePreviewHtml(
    '<!doctype html><html><head><title>Preview</title></head><body><h1>Ready</h1></body></html>',
    'preview-test-id',
  );
  assert.ok(preview.startsWith('<!doctype html><html>'));
  assert.match(preview, /default-src &#39;none&#39;|default-src 'none'/);
  assert.match(preview, /connect-src &#39;none&#39;|connect-src 'none'/);
  assert.match(preview, /nexo-preview-diagnostic/);
  assert.match(preview, /preview-test-id/);
  assert.match(preview, /<h1>Ready<\/h1>/);
  assert.doesNotMatch(preview, /allow-same-origin/);

  const diagnostic = sanitizePreviewDiagnostic({
    kind: 'error',
    message: 'x'.repeat(900),
    source: 'https://example.test/assets/app.js?private=value#section',
    line: 12,
  });
  assert.equal(diagnostic.message.length, 600);
  assert.equal(diagnostic.source, 'https://example.test/assets/app.js');
  assert.equal(diagnostic.line, 12);
  assert.equal(sanitizePreviewDiagnostic({ kind: 'unexpected', message: 'x' }), null);
});

test('editor modes are selected dynamically and repeated loads share a promise', async () => {
  const first = loadEditorLanguage('python');
  assert.equal(first, loadEditorLanguage('python'));
  assert.equal((await first).language.name, 'python');
  assert.equal((await loadEditorLanguage('javascript')).language.name, 'javascript');
  assert.equal((await loadEditorLanguage('html')).language.name, 'html');
});

test('Python worker stays warm, isolates each snippet, and loads only requested packages', async () => {
  const html = await readFile(new URL('../public/code-runner.html', import.meta.url), 'utf8');
  const source = html.match(/<script id="worker-source" type="text\/plain">([\s\S]*?)<\/script>/)[1];
  const imports = [], scripts = [], executed = [], messages = [], namespaces = [];
  let pyodideLoads = 0;
  const context = vm.createContext({
    importScripts: (url) => scripts.push(url),
    postMessage: (message) => messages.push(message),
    _: {},
    math: {},
    loadPyodide: async () => {
      pyodideLoads++;
      return {
        setStdout() {}, setStderr() {}, globals: { set() {} },
        loadPackage: () => assert.fail('Unconditional packages must not load'),
        loadPackagesFromImports: async (code) => imports.push(code),
        runPython: () => {
          const namespace = { set() {}, destroy() {} };
          namespaces.push(namespace);
          return namespace;
        },
        runPythonAsync: async (code, options) => { executed.push({ code, options }); },
      };
    },
  });
  context.self = context;
  vm.runInContext(source, context);
  const codes = ['print(5)', 'import numpy as np\nprint(np.arange(3))', 'import matplotlib.pyplot as plt\nplt.plot([1,2])'];
  for (const [index, code] of codes.entries()) {
    await context.onmessage({ data: { type: 'run', runId: `python-${index}`, language: 'python', code } });
    assert.equal(imports.at(-1), code);
  }
  assert.equal(scripts.length, 1, 'Python runtime loads once and JavaScript libraries remain unloaded');
  assert.ok(scripts[0].includes('pyodide'));
  assert.equal(pyodideLoads, 1);
  assert.equal(namespaces.length, codes.length, 'Each snippet receives a fresh Python namespace');
  assert.notEqual(namespaces[0], namespaces[1]);
  assert.notEqual(namespaces[1], namespaces[2]);
  assert.ok(executed.some(({ code }) => code.includes('MPLBACKEND')));
  assert.ok(codes.every((code) => executed.some((run) => run.code === code && run.options?.globals)));
  assert.equal(messages.filter((message) => message.type === 'done' && !message.error).length, 3);
  assert.ok(messages.every((message) => message.runId));

  await context.onmessage({ data: { type: 'run', runId: 'javascript-1', language: 'javascript', code: 'console.log("ok")' } });
  assert.equal(scripts.length, 3, 'Lodash and MathJS load only when JavaScript runs');
  await context.onmessage({ data: { type: 'run', runId: 'python-4', language: 'python', code: 'print("again")' } });
  assert.equal(scripts.length, 3, 'Switching languages does not reload the warm runtime or libraries');
  assert.equal(pyodideLoads, 1);
  assert.equal(namespaces.length, codes.length + 1);
  assert.ok(messages.some((message) => message.type === 'done' && message.runId === 'javascript-1' && !message.error));
  assert.ok(messages.some((message) => message.type === 'done' && message.runId === 'python-4' && !message.error));
});
