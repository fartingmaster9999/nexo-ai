import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWidget, parseWidget, sanitizeQuizProgress, parseQuizStates } from '../src/lib/interactive-widgets.ts';
import { fencedBlocks } from '../src/lib/fenced-blocks.ts';
import { extractSnippets } from '../src/lib/code-extract.ts';
import { parseConversation } from '../src/lib/conversation-storage.ts';
import { quiz, chart, math, donut, bar, scatter, fence } from './widget-data.mjs';

test('all chart types and biology quiz validate into bounded declarative data', () => {
  for (const widget of [quiz, chart, math, donut, bar, scatter]) assert.equal(parseWidget(JSON.stringify(widget)).status, 'valid');
  const parsed = validateWidget(math).widget;
  assert.equal(parsed.series[0].points.length, 61);
  assert.equal(parsed.series[0].points[30].y, 0);
  assert.equal(parsed.series[1].points[0].y, 9);
  assert.ok(Math.abs(parsed.series[0].points.at(-1).y - Math.sin(3)) < 1e-12);
});

test('malformed, oversized, unknown and invalid numerical output fail without throwing', () => {
  for (const value of ['{', '{}', 'null', JSON.stringify({ ...quiz, type: 'html' }), 'x'.repeat(60001), '"' + '✓'.repeat(21000) + '"']) assert.equal(parseWidget(value).status, 'invalid');
  for (const change of [
    { version: 2 }, { id: '__proto__' }, { questions: [] },
    { questions: [{ ...quiz.questions[0], answerId: 'missing' }] },
    { questions: [quiz.questions[0], quiz.questions[0]] },
  ]) assert.equal(validateWidget({ ...quiz, ...change }).status, 'invalid');
  for (const bad of [Infinity, NaN, 1e14, '123', undefined]) {
    assert.equal(validateWidget({ ...chart, series: [{ id: 'x', name: 'X', points: [{ x: 0, y: bad }] }] }).status, 'invalid');
  }
  assert.equal(validateWidget({ ...chart, series: [{ id: '__x', name: 'X', points: [{ x: 0, y: 1 }] }] }).status, 'invalid');
  assert.equal(validateWidget({ ...math, series: [{ ...math.series[0], formula: { fn: 'eval', min: 0, max: 2 } }] }).status, 'invalid');
  assert.equal(validateWidget({ ...math, series: [{ ...math.series[0], formula: { fn: 'exp', min: 0, max: 1000 } }] }).status, 'invalid');
  assert.equal(validateWidget({ ...math, series: [{ ...math.series[0], formula: { fn: 'sin', min: 0, max: 2, samples: 100000 } }] }).status, 'invalid');
});

test('provenance, dates, nonnegative composition and missing values are enforced', () => {
  assert.equal(validateWidget({ ...chart, provenance: { kind: 'verified', detail: 'Test' } }).status, 'invalid');
  assert.equal(validateWidget({ ...chart, provenance: { kind: 'verified', detail: 'Test', sources: [{ title: 'unsafe', url: 'javascript:alert(1)' }] } }).status, 'invalid');
  assert.equal(validateWidget({ ...donut, series: [{ ...donut.series[0], points: [{ x: 'A', y: -1 }, { x: 'B', y: 2 }] }] }).status, 'invalid');
  const temporal = (date) => ({ ...chart, x: { label: 'Date', type: 'time' }, series: [{ id: 'one', name: 'One', points: [{ x: date, y: 1 }] }] });
  assert.equal(validateWidget(temporal('2026-02-30')).status, 'invalid');
  assert.equal(validateWidget(temporal('2026-01-01T12:00:00')).status, 'invalid');
  assert.equal(validateWidget(temporal('2026-01-01T23:30:00-05:00')).status, 'valid');
  assert.equal(validateWidget(chart).widget.series[1].points[1].y, null);
  assert.equal(validateWidget({ ...scatter, series: [{ id: 'one', name: 'One', points: [{ x: 1, y: 2 }, { x: 1, y: 3 }] }] }).status, 'valid');
});

test('quiz progress is bounded, answer-compatible and attached to persisted message identities', () => {
  const progress = { index: 2, answers: { q1: 'a', q2: 'bad', constructor: 'a' }, submitted: ['q1', 'q2', 'unknown', 'q1'] };
  const safe = sanitizeQuizProgress(progress, quiz);
  assert.deepEqual(safe, { index: 1, answers: { q1: 'a' }, submitted: ['q1'] });
  const conversation = parseConversation({ id: 'one', title: 'Biology', createdAt: 1, updatedAt: 2,
    messages: [{ id: 'message-one', role: 'assistant', content: fence(quiz), quizProgress: { '0:biology': safe } }] });
  assert.equal(conversation.messages[0].id, 'message-one');
  assert.deepEqual(conversation.messages[0].quizProgress['0:biology'], safe);
  assert.deepEqual(parseQuizStates({ __proto__: { polluted: true }, nonsense: safe }), {});
});

test('widget fences never become runnable code, including code-like strings and partial JSON', () => {
  const withCodeString = { ...quiz, fallback: 'Example ```python\\nprint(7)\\n``` is text, not executable.' };
  assert.deepEqual(extractSnippets(fence(withCodeString)), []);
  assert.deepEqual(extractSnippets('```nexo-widget\n{"type":"quiz","text":"```python\nprint(7)'), []);
  const text = fence(quiz) + '\n\n```python\nprint(7)\n```\n\n~~~javascript\nconsole.log(1)\n~~~';
  assert.equal(fencedBlocks(text).length, 3);
  assert.deepEqual(extractSnippets(text).map((s) => s.language), ['python', 'javascript']);
  assert.equal(fencedBlocks('```nexo-widget\n{"version":1')[0].complete, false);
});
