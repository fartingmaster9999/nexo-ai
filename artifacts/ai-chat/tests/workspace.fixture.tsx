import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CodeWorkspace } from '../src/components/code-workspace';
import { MessageMarkdown } from '../src/components/message-markdown';
import { executeCode } from '../src/lib/code-runner';
import type { RunLanguage } from '../src/lib/code-runner';
import '../src/index.css';
import '../src/nexo.css';
import '../src/refine.css';

const raw = '\tprint("hello ✓")  \r\n\r\n';
const markdown = `Inline \`not a block\`.\n\n\`\`\`python\r\n${raw}\`\`\`\n\n~~~rust\nfn main() {}\n~~~`;

function Fixture() {
  const [open, setOpen] = useState(new URLSearchParams(location.search).has('open'));
  const [language, setLanguage] = useState<RunLanguage>('python');
  const [code, setCode] = useState('print("hello")\n');
  const [conversation, setConversation] = useState('workspace-fixture');
  const conversationControlRef = useRef<HTMLButtonElement>(null);
  Object.assign(window, {
    __workspaceFixture: {
      raw,
      open: (value: boolean) => flushSync(() => setOpen(value)),
      generated: (value: RunLanguage, text: string) => flushSync(() => { setLanguage(value); setCode(text); }),
      conversation: (value: string) => flushSync(() => setConversation(value)),
      execute: executeCode,
    },
  });
  return <div className="app-shell">
    <main className="main-pane"><div className="markdown" style={{ padding: 28 }}>
      <h1>Workspace checks</h1>
      <button ref={conversationControlRef} type="button" onClick={() => setOpen(true)} data-testid="button-conversation-control">Conversation</button>
      <MessageMarkdown content={markdown} />
    </div></main>
    {open && <CodeWorkspace conversationId={conversation}
      snippets={[{ language, code, label: 'Test code', complete: true }]}
      onClose={() => setOpen(false)}
      returnFocus={() => conversationControlRef.current?.focus({ preventScroll: true })}
      onAskFix={() => {}} canAsk isLight={false} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
