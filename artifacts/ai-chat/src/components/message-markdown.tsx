import { createContext, memo, useContext } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyCodeButton } from './copy-code-button';
import { rawCodeFromSource } from '@/lib/code-clipboard';

const MarkdownSource = createContext('');

const CodeBlock: NonNullable<Components['pre']> = ({ node, children, ...props }) => {
  const source = useContext(MarkdownSource);
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const fallback = code?.type === 'element'
    ? code.children.map((child) => child.type === 'text' ? child.value : '').join('') : '';
  const raw = rawCodeFromSource(source, node?.position?.start.offset, node?.position?.end.offset, fallback);
  const classes = code?.type === 'element' ? code.properties.className : [];
  const language = (Array.isArray(classes) ? classes.join(' ') : String(classes ?? '')).match(/language-([^\s]+)/)?.[1] ?? 'Code';
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
const plugins = [remarkGfm];

/** Completed answers do not reparse Markdown on each streamed chunk or keystroke. */
export const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }) {
  return <MarkdownSource.Provider value={content}><ReactMarkdown remarkPlugins={plugins} skipHtml components={components}>{content}</ReactMarkdown></MarkdownSource.Provider>;
});
