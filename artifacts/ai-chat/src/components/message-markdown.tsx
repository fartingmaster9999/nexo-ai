import { createContext, lazy, memo, Suspense, useContext, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { CopyCodeButton } from './copy-code-button';
import { rawCodeFromSource } from '@/lib/code-clipboard';
import { fencedBlocks, type FencedBlock } from '@/lib/fenced-blocks';
import { parseWidget, WIDGET_LANGUAGE, type QuizProgress } from '@/lib/interactive-widgets';
import { ErrorBoundary } from './error-boundary';

const InteractiveWidgetView = lazy(() => import('./interactive/widget-view'));
type ProgressHandler = (conversationId: string, messageId: string, widgetKey: string, progress: QuizProgress) => void;
type MarkdownProps = {
  content: string; live?: boolean; conversationId?: string; messageId?: string;
  quizProgress?: Record<string, QuizProgress>; onQuizProgress?: ProgressHandler; sources?: { url: string }[];
};
const MarkdownSource = createContext<MarkdownProps & { blocks: FencedBlock[] }>({ content: '', blocks: [] });
function WidgetFailure() {
  return <div className="widget-fallback" role="status">This interactive answer could not load. Your conversation is still here. Reload the page or ask for a plain-text answer.</div>;
}

const CodeBlock: NonNullable<Components['pre']> = ({ node, children, ...props }) => {
  const context = useContext(MarkdownSource);
  const source = context.content;
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const fallback = code?.type === 'element'
    ? code.children.map((child) => child.type === 'text' ? child.value : '').join('') : '';
  const raw = rawCodeFromSource(source, node?.position?.start.offset, node?.position?.end.offset, fallback);
  const classes = code?.type === 'element' ? code.properties.className : [];
  const language = (Array.isArray(classes) ? classes.join(' ') : String(classes ?? '')).match(/language-([^\s]+)/)?.[1] ?? 'Code';
  const start = node?.position?.start.offset ?? -1;
  const block = context.blocks.find((block) => block.start <= start && block.end >= (node?.position?.end.offset ?? start));
  const result = useMemo(() => language.toLowerCase() === WIDGET_LANGUAGE && block?.complete ? parseWidget(block.code) : null, [language, block?.complete, block?.code]);
  if (language.toLowerCase() === WIDGET_LANGUAGE) {
    if (!block?.complete) return <div className="widget-fallback" role="status">{context.live ? 'Preparing an interactive answer…' : 'This interactive answer was not completed. Ask Nexo to try again.'}</div>;
    const siblings = context.blocks.filter((block) => block.tag === WIDGET_LANGUAGE);
    if (siblings.indexOf(block) >= 4) return <div className="widget-fallback">Ask for fewer charts or quizzes in one answer.</div>;
    if (!result || result.status === 'invalid') return <div className="widget-fallback" role="status">{result?.fallback ?? 'This interactive answer could not be displayed.'}</div>;
    const widget = result.widget;
    if (widget.type === 'chart' && widget.provenance.kind === 'verified') {
      const sourceUrls = new Set((context.sources ?? []).map((source) => { try { return new URL(source.url).href; } catch { return ''; } }));
      if (!widget.provenance.sources.every((source) => sourceUrls.has(source.url))) {
        return <div className="widget-fallback" role="status">This chart's sources could not be verified against this answer's web results. Ask for a sourced chart or provide the data.</div>;
      }
    }
    const widgetKey = `${block.start}:${widget.id}`;
    return <ErrorBoundary FallbackComponent={WidgetFailure} resetKey={widgetKey}><Suspense fallback={<div className="widget-fallback" role="status">Loading interactive answer…</div>}>
      <InteractiveWidgetView widget={widget} progress={context.quizProgress?.[widgetKey]}
        onProgressChange={context.conversationId && context.messageId && context.onQuizProgress
          ? (progress) => context.onQuizProgress!(context.conversationId!, context.messageId!, widgetKey, progress) : undefined} />
    </Suspense></ErrorBoundary>;
  }
  return (
    <div className="code-block">
      <div className="code-block-toolbar"><span>{language}</span><CopyCodeButton text={raw} /></div>
      <pre {...props}>{children}</pre>
    </div>
  );
};

const components: Components = {
  pre: CodeBlock,
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />,
  table: ({ node: _node, ...props }) => <div className="table-wrap"><table {...props} /></div>,
};
const remarkPlugins = [remarkGfm, remarkMath];

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] };
const INLINE_OPEN = '\\(';
const INLINE_CLOSE = '\\)';
const DISPLAY_OPEN = '\\[';
const DISPLAY_CLOSE = '\\]';
const RAW_TEX_COMMAND = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|oint|lim|alpha|beta|gamma|delta|theta|pi|sigma|mu|infty|cdot|times|leq|geq|neq|approx|equiv|partial|nabla|text|left|right|begin|end|overline|underline|hat|bar|vec|boxed|mathbb|mathcal|mathrm|operatorname|sin|cos|tan|log|ln|exp|pm|mp|rightarrow|to|implies|therefore|quad|qquad|cases|matrix|det|Pr|mathbf|dots)\b/;

function isEscapedAt(source: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) slashes++;
  return slashes % 2 === 1;
}

function findUnescaped(source: string, token: string, from: number) {
  let index = source.indexOf(token, from);
  while (index >= 0 && isEscapedAt(source, index)) index = source.indexOf(token, index + token.length);
  return index;
}

function findCodeSpanEnd(source: string, start: number, ticks: number) {
  const marker = '`'.repeat(ticks);
  let end = source.indexOf(marker, start + ticks);
  while (end >= 0) {
    const isLongerRun = source[end - 1] === '`' || source[end + ticks] === '`';
    if (!isLongerRun) return end + ticks;
    end = source.indexOf(marker, end + ticks);
  }
  return -1;
}

function findMathOpening(source: string, from: number) {
  for (let cursor = from; cursor < source.length;) {
    if (source[cursor] === '`') {
      let ticks = 1;
      while (source[cursor + ticks] === '`') ticks++;
      const codeEnd = findCodeSpanEnd(source, cursor, ticks);
      if (codeEnd >= 0) {
        cursor = codeEnd;
        continue;
      }
    }
    if (!isEscapedAt(source, cursor)) {
      if (source.startsWith(INLINE_OPEN, cursor)) return { start: cursor, isDisplay: false };
      if (source.startsWith(DISPLAY_OPEN, cursor)) return { start: cursor, isDisplay: true };
    }
    cursor++;
  }
  return null;
}

function isBareMathLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || line.startsWith('    ') || line.startsWith('\t') || /[`$]/.test(trimmed)
    || trimmed.includes(INLINE_OPEN) || trimmed.includes(DISPLAY_OPEN)) return false;

  const hasTexCommand = RAW_TEX_COMMAND.test(trimmed);
  const hasEquationSyntax = /[=<>^_∑∫√±×÷≤≥≠≈]/.test(trimmed);
  if (!hasTexCommand && !hasEquationSyntax) return false;

  if (hasTexCommand) {
    const prose = trimmed.replace(/\\[A-Za-z]+/g, ' ').replace(/[{}[\]\\]/g, ' ');
    const words = prose.match(/[A-Za-z]{3,}/g) ?? [];
    return words.length <= 2;
  }

  const words = trimmed.match(/[A-Za-z]{3,}/g) ?? [];
  return words.length === 0 && /[A-Za-z0-9]/.test(trimmed);
}

/** Render unwrapped, standalone formulas without changing fenced or inline code. */
function normalizeBareMathLines(source: string) {
  return source.split(/(\r?\n)/).map((line) => {
    if (line === '\n' || line === '\r\n' || !isBareMathLine(line)) return line;
    return `\n\n$$\n${line.trim()}\n$$\n\n`;
  }).join('');
}

/** Convert common TeX delimiters without touching fenced or inline code source. */
function normalizeMathSegment(source: string) {
  let output = '';
  let cursor = 0;
  while (cursor < source.length) {
    if (source[cursor] === '`') {
      let ticks = 1;
      while (source[cursor + ticks] === '`') ticks++;
      const end = findCodeSpanEnd(source, cursor, ticks);
      if (end >= 0) {
        output += source.slice(cursor, end);
        cursor = end;
        continue;
      }
    }

    const opening = findMathOpening(source, cursor);
    if (!opening) {
      output += source.slice(cursor);
      break;
    }

    const { start, isDisplay } = opening;
    const open = isDisplay ? DISPLAY_OPEN : INLINE_OPEN;
    const close = isDisplay ? DISPLAY_CLOSE : INLINE_CLOSE;
    const end = findUnescaped(source, close, start + open.length);
    const expression = end >= 0 ? source.slice(start + open.length, end).trim() : '';
    if (end < 0 || !expression) {
      output += source.slice(cursor, start + open.length);
      cursor = start + open.length;
      continue;
    }

    output += source.slice(cursor, start);
    output += isDisplay ? `\n\n$$\n${expression}\n$$\n\n` : `$${expression}$`;
    cursor = end + close.length;
  }
  return normalizeBareMathLines(output);
}

function normalizeMathDelimiters(source: string) {
  const codeBlocks = fencedBlocks(source);
  if (codeBlocks.length === 0) return normalizeMathSegment(source);

  let result = '';
  let cursor = 0;
  for (const block of codeBlocks) {
    result += normalizeMathSegment(source.slice(cursor, block.start));
    result += source.slice(block.start, block.end);
    cursor = block.end;
  }
  return result + normalizeMathSegment(source.slice(cursor));
}

/** Completed answers do not reparse Markdown on each streamed chunk or keystroke. */
export const MessageMarkdown = memo(function MessageMarkdown(props: MarkdownProps) {
  const markdown = useMemo(() => normalizeMathDelimiters(props.content), [props.content]);
  const blocks = useMemo(() => fencedBlocks(markdown), [markdown]);
  const context = useMemo(() => ({ ...props, content: markdown, blocks }), [markdown, props.live, props.conversationId, props.messageId, props.quizProgress, props.onQuizProgress, props.sources, blocks]);
  return <MarkdownSource.Provider value={context}><ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={[[rehypeKatex, { throwOnError: false, maxExpand: 500, maxSize: 20 }]]} skipHtml components={components}>{markdown}</ReactMarkdown></MarkdownSource.Provider>;
});
