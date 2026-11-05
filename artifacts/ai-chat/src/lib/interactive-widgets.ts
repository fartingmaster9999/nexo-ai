/** Declarative data only. Model-authored JavaScript/HTML/options are never evaluated. */
export type QuizProgress = { index: number; answers: Record<string, string>; submitted: string[] };
export type QuizQuestion = { id: string; prompt: string; options: { id: string; text: string }[]; answerId: string; explanation: string };
type WidgetBase = { version: 1; id: string; title: string; fallback: string; description?: string };
export type QuizWidget = WidgetBase & { type: 'quiz'; questions: QuizQuestion[] };
export type ChartPoint = { x: string | number; y: number | null };
export type ChartWidget = WidgetBase & {
  type: 'chart'; chartType: 'line' | 'bar' | 'scatter' | 'donut';
  x: { label: string; unit: string; type: 'category' | 'number' | 'time' };
  y: { label: string; unit: string };
  provenance: { kind: 'provided' | 'verified' | 'calculated' | 'illustrative'; detail: string; sources: { title: string; url: string }[] };
  series: { id: string; name: string; points: ChartPoint[] }[];
};
export type InteractiveWidget = QuizWidget | ChartWidget;
export const WIDGET_LANGUAGE = 'nexo-widget';
export const MAX_WIDGET_BYTES = 60000;
export const emptyQuizProgress = (): QuizProgress => ({ index: 0, answers: {}, submitted: [] });

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid text');
  return value.trim();
}
function id(value: unknown): string {
  const result = text(value, 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(result) || ['__proto__', 'constructor', 'prototype', '__x'].includes(result)) throw new Error('Invalid id');
  return result;
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error('Invalid number');
  return value;
}
function list(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('Invalid list');
  return value;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw new Error('Duplicate id');
}
function object(value: unknown) {
  if (!record(value)) throw new Error('Invalid object');
  return value;
}
function unit(value: unknown) { return value === undefined || value === '' ? '' : text(value, 40); }
function source(value: unknown) {
  const row = object(value), url = new URL(text(row.url, 1000));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe source');
  return { title: text(row.title, 120), url: url.href };
}
function formulaPoints(value: unknown): ChartPoint[] {
  const f = object(value);
  const fn = text(f.fn, 20), a = finite(f.a ?? 1), b = finite(f.b ?? 0), c = finite(f.c ?? 0);
  const min = finite(f.min), max = finite(f.max), samples = finite(f.samples ?? 81);
  if (max <= min || !Number.isInteger(samples) || samples < 2 || samples > 200 ||
      !['linear', 'quadratic', 'sin', 'cos', 'exp'].includes(fn)) throw new Error('Invalid formula');
  return Array.from({ length: samples }, (_, i) => {
    const x = min + (max - min) * i / (samples - 1);
    const y = fn === 'linear' ? a * x + b : fn === 'quadratic' ? a * x * x + b * x + c
      : fn === 'sin' ? a * Math.sin(x + b) + c : fn === 'cos' ? a * Math.cos(x + b) + c
      : a * Math.exp(x + b) + c;
    return { x: finite(x), y: finite(y) };
  });
}
function axis(value: unknown) {
  const row = object(value);
  return { label: text(row.label, 100), unit: unit(row.unit) };
}

export type WidgetResult = { status: 'valid'; widget: InteractiveWidget } | { status: 'invalid'; fallback: string };
export function validateWidget(value: unknown): WidgetResult {
  let fallback = 'This interactive answer could not be displayed. Ask Nexo for a plain-text version.';
  try {
    const row = object(value);
    if (typeof row.fallback === 'string' && row.fallback.trim() && row.fallback.length <= 1600) fallback = row.fallback;
    if (row.version !== 1) throw new Error('Unsupported version');
    const base: WidgetBase = { version: 1, id: id(row.id), title: text(row.title, 180), fallback: text(row.fallback, 1600),
      ...(row.description === undefined ? {} : { description: text(row.description, 800) }) };
    if (row.type === 'quiz') {
      const questions = list(row.questions, 1, 15).map((value): QuizQuestion => {
        const question = object(value);
        const options = list(question.options, 2, 6).map((value) => {
          const option = object(value);
          return { id: id(option.id), text: text(option.text, 500) };
        });
        unique(options.map((option) => option.id));
        const answerId = id(question.answerId);
        if (!options.some((option) => option.id === answerId)) throw new Error('Unknown answer');
        return { id: id(question.id), prompt: text(question.prompt, 1000), options, answerId, explanation: text(question.explanation, 1200) };
      });
      unique(questions.map((question) => question.id));
      return { status: 'valid', widget: { ...base, type: 'quiz', questions } };
    }
    if (row.type !== 'chart' || !['line', 'bar', 'scatter', 'donut'].includes(String(row.chartType))) throw new Error('Unknown widget');
    const chartType = row.chartType as ChartWidget['chartType'];
    const rawX = object(row.x), x = { ...axis(rawX), type: rawX.type as ChartWidget['x']['type'] }, y = axis(row.y);
    if (!['category', 'number', 'time'].includes(x.type)) throw new Error('Unknown axis');
    if (chartType === 'scatter' && x.type !== 'number') throw new Error('Scatter requires numeric axes');
    if (chartType === 'donut' && x.type !== 'category') throw new Error('Composition requires categories');
    const rawProvenance = object(row.provenance);
    const kind = rawProvenance.kind as ChartWidget['provenance']['kind'];
    if (!['provided', 'verified', 'calculated', 'illustrative'].includes(kind)) throw new Error('Missing provenance');
    const provenance = { kind, detail: text(rawProvenance.detail, 800),
      sources: rawProvenance.sources === undefined ? [] : list(rawProvenance.sources, 0, 5).map(source) };
    if (kind === 'verified' && !provenance.sources.length) throw new Error('Verified data requires sources');
    let total = 0;
    const series = list(row.series, 1, chartType === 'donut' ? 1 : 6).map((value) => {
      const series = object(value);
      // Calculated plots use a bounded, known formula, never eval or model-supplied samples.
      if (kind === 'calculated' && (!series.formula || x.type !== 'number' || !['line', 'scatter'].includes(chartType))) throw new Error('Calculation requires formula');
      if (kind !== 'calculated' && series.formula !== undefined) throw new Error('Unexpected formula');
      const points = kind === 'calculated' ? formulaPoints(series.formula) : list(series.points, chartType === 'donut' ? 2 : 1, chartType === 'donut' ? 5 : 200).map((value): ChartPoint => {
        const point = object(value);
        let px: string | number;
        if (x.type === 'number') px = finite(point.x);
        else if (x.type === 'time') {
          if (typeof point.x !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(point.x)) throw new Error('Invalid date');
          const calendar = new Date(`${point.x.slice(0, 10)}T00:00:00Z`);
          if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== point.x.slice(0, 10)) throw new Error('Invalid calendar date');
          px = Date.parse(point.x);
          if (!Number.isFinite(px)) throw new Error('Invalid date');
        } else px = text(point.x, 100);
        return { x: px, y: point.y === null ? null : finite(point.y) };
      });
      total += points.length;
      if (total > 1000 || points.every((point) => point.y === null)) throw new Error('No usable data');
      if (chartType !== 'scatter') unique(points.map((point) => String(point.x)));
      if (chartType === 'donut' && (points.some((point) => point.y === null || point.y! < 0) || points.reduce((sum, point) => sum + point.y!, 0) <= 0)) throw new Error('Invalid composition');
      if (x.type !== 'category') points.sort((a, b) => Number(a.x) - Number(b.x));
      return { id: id(series.id), name: text(series.name, 100), points };
    });
    unique(series.map((series) => series.id));
    return { status: 'valid', widget: { ...base, type: 'chart', chartType, x, y, provenance, series } };
  } catch { return { status: 'invalid', fallback }; }
}

export function parseWidget(raw: string): WidgetResult {
  if (raw.length > MAX_WIDGET_BYTES || new TextEncoder().encode(raw).byteLength > MAX_WIDGET_BYTES) return { status: 'invalid', fallback: 'This interactive answer is too large. Ask Nexo for a smaller chart or quiz.' };
  try { return validateWidget(JSON.parse(raw)); }
  catch { return { status: 'invalid', fallback: 'This interactive answer is incomplete or malformed. Ask Nexo to try again in plain text.' }; }
}

/** State is data attached to its owning message, not a global prompt/title cache. */
export function sanitizeQuizProgress(value: unknown, widget?: QuizWidget): QuizProgress {
  const result = emptyQuizProgress();
  if (!record(value)) return result;
  const questions = widget?.questions;
  const allowed = questions ? new Map(questions.map((q) => [q.id, new Set(q.options.map((o) => o.id))])) : null;
  const entries = record(value.answers) ? Object.entries(value.answers).slice(0, 15) : [];
  result.answers = Object.fromEntries(entries.filter(([key, value]) => {
    try { id(key); id(value); return !allowed || allowed.get(key)?.has(String(value)); } catch { return false; }
  })) as Record<string, string>;
  result.submitted = Array.isArray(value.submitted)
    ? [...new Set(value.submitted.filter((key): key is string => typeof key === 'string' && Object.hasOwn(result.answers, key)))].slice(0, 15) : [];
  const maxIndex = questions ? questions.length : 15;
  result.index = typeof value.index === 'number' && Number.isInteger(value.index) ? Math.max(0, Math.min(maxIndex, value.index)) : 0;
  if (questions) {
    const firstPending = questions.findIndex((q) => !result.submitted.includes(q.id));
    if (firstPending >= 0) result.index = Math.min(result.index, firstPending);
  }
  return result;
}

export function parseQuizStates(value: unknown): Record<string, QuizProgress> | undefined {
  if (!record(value)) return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 4)
    .filter(([key]) => /^\d{1,8}:[a-zA-Z0-9_-]{1,64}$/.test(key))
    .map(([key, progress]) => [key, sanitizeQuizProgress(progress)]));
}
