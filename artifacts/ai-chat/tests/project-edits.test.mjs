import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProjectEdits, validateProjectEdits } from '../../../lib/api-zod/src/project-edits.ts';
import { createAgentProject, createSavedProject } from '../src/lib/project-workspace.ts';
import { ChatEventDecoder } from '../src/lib/chat-stream.ts';
import { privateAgentHistory, writeAgentCheckpoint, readAgentCheckpoint } from '../src/lib/agent-checkpoint.ts';

const files = [
  { path: 'index.html', content: '<!doctype html>\r\n<h1>Original title</h1>\r\n<script src="app.js"></script>' },
  { path: 'app.js', content: 'const untouched = "keep exactly";\n'.repeat(180) },
];
const edits = [{ path: 'index.html', oldText: 'Original title', newText: 'New title' }];
const args = { entrypoint: 'index.html', edits };
const exchange = { tool: 'edit_project', callId: 'edit-1', thoughtSignature: 'groq-agent-v1', arguments: args, result: 'Nexo execution status: completed.' };

test('a small edit preserves all unrelated bytes and avoids a full-file tool response', () => {
  const original = structuredClone(files);
  const updated = applyProjectEdits(files, ['index.html'], edits);
  assert.deepEqual(files, original);
  assert.equal(updated[0].content, files[0].content.replace('Original title', 'New title'));
  assert.equal(updated[1].content, files[1].content);
  assert.ok(JSON.stringify(args).length < JSON.stringify({ entrypoint: 'index.html', files }).length / 20);
  const previous = createSavedProject(files, 'index.html', ['index.html']);
  const project = createAgentProject(updated, 'index.html', previous);
  assert.deepEqual(project.selectedPaths, ['index.html']);
  assert.equal(project.files[1].content, original[1].content);
});

test('all edits validate atomically against original selected source', () => {
  const original = structuredClone(files);
  for (const invalid of [
    [...edits, { path: 'app.js', oldText: 'missing', newText: 'x' }],
    [{ path: 'index.html', oldText: 'missing', newText: 'x' }],
    [{ path: 'app.js', oldText: 'const untouched', newText: 'x' }],
    [{ path: 'missing.js', oldText: 'x', newText: 'y' }],
    [...edits, { path: 'index.html', oldText: 'title', newText: 'x' }],
    [...edits, ...edits],
    [...edits, { path: 'index.html', oldText: 'New title', newText: 'other' }],
  ]) {
    assert.throws(() => applyProjectEdits(files, files.map(f => f.path), invalid));
    assert.deepEqual(files, original);
  }
  assert.throws(() => applyProjectEdits(files, [], edits), /not selected/);
  assert.throws(() => applyProjectEdits([{ path: 'x', content: 'aaa' }], ['x'], [{ path: 'x', oldText: 'aa', newText: '' }]), /ambiguous/);
});

test('bounded paths, text, counts and total size reject unsafe payloads', () => {
  for (const invalid of [
    [], Array(17).fill(edits[0]),
    [{ ...edits[0], oldText: '' }],
    [{ ...edits[0], newText: 'x'.repeat(2001) }],
    Array(5).fill({ ...edits[0], oldText: 'x'.repeat(1800) }),
    ...['../index.html', '/index.html', 'a//b', 'a\\b', 'a/./b', 'https://example.com'].map(path => [{ ...edits[0], path }]),
  ]) assert.throws(() => validateProjectEdits(invalid));
  assert.deepEqual(applyProjectEdits(files, ['index.html'], [{ ...edits[0], newText: '' }])[0].content, files[0].content.replace('Original title', ''));
});

test('SSE and persisted consumed edits retain their identity and diagnostics', () => {
  const tool = { ...exchange, history: [] };
  delete tool.result;
  const events = new ChatEventDecoder().push(new TextEncoder().encode(`data: ${JSON.stringify({ agentTool: tool })}\n\n`));
  assert.deepEqual(events[0].agentTool, tool);
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const checkpoint = {
    version: 1, conversationId: 'edits', assistantId: 'answer', messages: [{ role: 'user', content: 'Change the title' }],
    deepthink: false, imageRequired: false, provider: 'groq', model: 'qwen/test', task: 'coding',
    history: [{ ...exchange, result: 'Interrupted tool: do not replay.' }], toolCalls: 1, retries: 0,
    startedAt: Date.now(), waitUntil: 0, phase: 'executing',
  };
  writeAgentCheckpoint(storage, checkpoint);
  assert.deepEqual(readAgentCheckpoint(storage, 'edits').checkpoint, checkpoint);
  const redacted = privateAgentHistory([exchange], createSavedProject(files, 'index.html', []));
  assert.equal(redacted[0].callId, exchange.callId);
  assert.equal(redacted[0].result, exchange.result);
  assert.ok(!JSON.stringify(redacted).includes('Original title'));
  assert.ok(!JSON.stringify(redacted).includes('New title'));
});
