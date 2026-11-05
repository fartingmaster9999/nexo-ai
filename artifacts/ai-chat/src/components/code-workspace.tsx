import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { Play, Square, Wrench, X, RotateCcw, Download, Terminal } from 'lucide-react';
import { executeCode, type RunLanguage, type RunOutput } from '@/lib/code-runner';
import { LANG_LABEL, STARTERS, type Snippet } from '@/lib/code-extract';
import { CopyCodeButton } from './copy-code-button';
import { useEditorLanguage } from '@/hooks/use-editor-language';
import { useWorkspaceSize } from '@/hooks/use-workspace-size';
import './code-workspace.css';

type Draft = { language: RunLanguage; code: string; edited: boolean };
const DRAFT_KEY = 'nexo-code-drafts-v1';
function readDrafts(): Record<string, Draft> {
  try { const v = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

type Props = {
  conversationId: string | null;
  snippets: Snippet[];
  onClose: () => void;
  onAskFix: (prompt: string) => void;
  canAsk: boolean;
  isLight: boolean;
};

export function CodeWorkspace({ conversationId, snippets, onClose, onAskFix, canAsk, isLight }: Props) {
  const key = conversationId ?? '__scratch';
  const [drafts, setDrafts] = useState<Record<string, Draft>>(readDrafts);
  const [sel, setSel] = useState(0);
  const [running, setRunning] = useState(false);
  const [outputs, setOutputs] = useState<RunOutput[]>([]);
  const [runError, setRunError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [storageError, setStorageError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const snippetCount = snippets.length;
  useEffect(() => { setSel(Math.max(0, snippetCount - 1)); }, [key, snippetCount]);
  const generated = snippets[Math.min(sel, snippetCount - 1)];
  const draft: Draft = drafts[key] ?? (generated ? { ...generated, edited: false } : { language: 'python', code: STARTERS.python, edited: false });

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); setStorageError(''); }
    catch { setStorageError('Your code edits could not be saved in this browser. Copy them before leaving.'); }
  }, [drafts]);

  const genCode = generated?.code; const genLang = generated?.language;
  useEffect(() => {
    if (genCode === undefined || !genLang) return;
    setDrafts((d) => {
      const cur = d[key];
      if (cur?.edited || (cur && cur.code === genCode && cur.language === genLang)) return d;
      return { ...d, [key]: { language: genLang, code: genCode, edited: false } };
    });
  }, [key, genCode, genLang]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setOutputs([]); setRunError(''); setPreview(null); setHasRun(false);
  }, [key]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight }); }, [outputs, runError]);

  const setDraft = (patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [key]: { ...draft, ...patch, edited: true } }));
  const editorLanguage = useEditorLanguage(draft.language);
  const workspaceSize = useWorkspaceSize();
  const differs = !!generated && draft.edited && (generated.code !== draft.code || generated.language !== draft.language);

  const run = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true); setOutputs([]); setRunError(''); setHasRun(true);
    if (draft.language !== 'html') setPreview(null);
    try {
      const res = await executeCode({ language: draft.language, code: draft.code, signal: ctrl.signal, onOutput: (o) => { if (abortRef.current === ctrl) setOutputs((x) => [...x, o]); } });
      if (abortRef.current !== ctrl) return;
      if (res.previewHtml) setPreview(res.previewHtml);
      if (res.error) setRunError(res.error);
    } catch (e) {
      if (abortRef.current !== ctrl) return;
      if (e instanceof DOMException && e.name === 'AbortError') setOutputs((x) => [...x, { kind: 'status', text: 'Stopped.' }]);
      else setRunError(e instanceof Error ? e.message : 'The runner failed to start.');
    } finally {
      if (abortRef.current === ctrl) { abortRef.current = null; setRunning(false); }
    }
  };
  const stop = () => { abortRef.current?.abort(); abortRef.current = null; setRunning(false); setOutputs((x) => [...x, { kind: 'status', text: 'Stopped.' }]); };

  const askFix = () => {
    const errs = [runError, ...outputs.filter((o) => o.kind === 'stderr').map((o) => o.text ?? '')].filter(Boolean).join('\n');
    const out = outputs.filter((o) => o.kind === 'stdout').map((o) => o.text ?? '').join('').slice(-800);
    const summary = (errs || out || (hasRun ? 'It ran without visible output.' : 'Not run yet.')).slice(0, 2000);
    const fence = draft.language === 'html' ? 'html' : draft.language;
    onAskFix(`Please fix this ${LANG_LABEL[draft.language]} code from my workspace and return the full corrected version.\n\n\`\`\`${fence}\n${draft.code.slice(0, 8000)}\n\`\`\`\n\n${errs ? 'Errors' : 'Console'}:\n${summary}`);
  };

  return (
    <aside id="code-workspace" className="workspace workspace-resizable" style={{ ['--workspace-width' as string]: `${workspaceSize.width}px` }} aria-label="Code workspace" data-testid="panel-workspace">
      <div className="workspace-resizer" role="separator" aria-orientation="vertical" aria-label="Resize code workspace"
        aria-controls="code-workspace" tabIndex={0} aria-valuemin={workspaceSize.bounds.min} aria-valuemax={workspaceSize.bounds.max}
        aria-valuenow={workspaceSize.width} aria-valuetext={`${workspaceSize.width} pixels wide`}
        {...workspaceSize.separatorProps} data-testid="separator-workspace" />
      <header className="ws-head">
        <Terminal size={15} aria-hidden="true" className="ws-icon" />
        <span className="ws-title">Workspace</span>
        <select className="ws-select" value={draft.language} aria-label="Language" onChange={(e) => setDraft({ language: e.target.value as RunLanguage })} data-testid="select-language">
          {(Object.keys(LANG_LABEL) as RunLanguage[]).map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
        </select>
        {running ? (
          <button type="button" className="ws-btn stop" onClick={stop} data-testid="button-stop-code"><Square size={13} /> Stop</button>
        ) : (
          <button type="button" className="ws-btn run" onClick={() => void run()} disabled={!draft.code.trim()} data-testid="button-run-code"><Play size={13} /> Run</button>
        )}
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close workspace" data-testid="button-close-workspace"><X size={16} /></button>
      </header>
      {storageError && <div className="ws-banner" role="alert">{storageError}</div>}
      {editorLanguage.loading && <div className="ws-language-status" role="status">Loading {LANG_LABEL[draft.language]} highlighting… You can keep editing.</div>}
      {editorLanguage.error && <div className="ws-language-status" role="status">
        Highlighting could not load. Plain-text editing is still available.
        <button type="button" onClick={editorLanguage.retry}>Retry highlighting</button>
      </div>}

      {snippets.length > 1 && (
        <div className="ws-snippets" role="tablist" aria-label="Generated snippets">
          {snippets.map((s, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === sel} className={i === sel ? 'is-on' : ''} onClick={() => setSel(i)} data-testid={`tab-snippet-${i}`}>
              {i + 1}. {LANG_LABEL[s.language]}
            </button>
          ))}
        </div>
      )}
      {differs && (
        <div className="ws-banner" data-testid="status-generated-differs">
          <span>Your edits are kept. Nexo has a newer generated version.</span>
          <button type="button" onClick={() => setDrafts((d) => ({ ...d, [key]: { language: generated!.language, code: generated!.code, edited: false } }))} data-testid="button-load-generated"><Download size={12} /> Load generated version</button>
        </div>
      )}

      <div className="ws-editor">
        <CodeMirror value={draft.code} height="100%" theme={isLight ? 'light' : 'dark'} extensions={editorLanguage.extensions}
          onChange={(v) => { if (v !== draft.code) setDraft({ code: v }); }} aria-label="Code editor" data-testid="editor-code" />
      </div>

      <div className="ws-out">
        <div className="ws-out-head">
          <span>{draft.language === 'html' ? 'Preview' : 'Console'}</span>
          <span className="ws-out-actions">
            <CopyCodeButton text={draft.code} label="Copy workspace code" />
            <button type="button" className="ws-mini" onClick={() => setDraft({ code: STARTERS[draft.language] })} title="Replace with starter" data-testid="button-reset-code"><RotateCcw size={11} /> Starter</button>
            <button type="button" className="ws-mini accent" disabled={!canAsk} onClick={askFix} title={canAsk ? 'Send code and output to Nexo' : 'Wait for the current reply to finish'} data-testid="button-ask-fix"><Wrench size={11} /> Ask Nexo to fix</button>
          </span>
        </div>
        {draft.language === 'html' && preview ? (
          <iframe className="ws-preview" sandbox="allow-scripts" srcDoc={preview} title="HTML preview" data-testid="frame-preview" />
        ) : (
          <div className="ws-console" ref={consoleRef} role="log" aria-live="polite" data-testid="console-output">
            {!hasRun && <p className="c-status">Runs Python, JavaScript and HTML/CSS only, inside a sandbox in your browser. Nothing runs on the server. Python loads when you run it; supported packages load only when imported by your code.</p>}
            {outputs.map((o, i) => o.kind === 'image' && o.dataUrl
              ? <img key={i} src={o.dataUrl} alt={`Plot output ${i + 1}`} className="c-img" />
              : <pre key={i} className={`c-${o.kind}`}>{o.text}</pre>)}
            {running && <p className="c-status c-live">running...</p>}
            {hasRun && !running && !runError && outputs.length === 0 && draft.language !== 'html' && <p className="c-status">Finished with no output.</p>}
            {runError && <pre className="c-stderr" role="alert">{runError}</pre>}
          </div>
        )}
      </div>
    </aside>
  );
}
