import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />,
  table: ({ node: _node, ...props }) => <div className="table-wrap"><table {...props} /></div>,
};
const plugins = [remarkGfm];

/** Completed answers do not reparse Markdown on each streamed chunk or keystroke. */
export const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={plugins} skipHtml components={components}>{content}</ReactMarkdown>;
});
