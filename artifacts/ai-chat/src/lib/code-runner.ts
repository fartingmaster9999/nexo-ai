export type RunLanguage = 'python' | 'javascript' | 'html';
export type RunOutput = { kind: 'stdout' | 'stderr' | 'status' | 'image'; text?: string; dataUrl?: string };
export type ExecutionResult = { outputs: RunOutput[]; error?: string; previewHtml?: string };

/** HTML previews MUST also use an iframe with sandbox="allow-scripts", never allow-same-origin. */
export function makePreviewHtml(code: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: blob: https:; connect-src https://cdn.jsdelivr.net; form-action 'none'; base-uri 'none'; frame-src 'none'";
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1">${code}`;
}

/** Untrusted code runs in an opaque-origin iframe and worker, never on the application server. */
export async function executeCode(options: {
  language: RunLanguage;
  code: string;
  onOutput?: (output: RunOutput) => void;
  signal?: AbortSignal;
}): Promise<ExecutionResult> {
  if (options.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  if (options.language === 'html') return { outputs: [], previewHtml: makePreviewHtml(options.code) };
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.sandbox.add('allow-scripts');
    frame.hidden = true;
    frame.title = 'Isolated code runner';
    frame.src = `${import.meta.env.BASE_URL}code-runner.html`;
    const runId = crypto.randomUUID();
    const outputs: RunOutput[] = [];
    let totalSize = 0;
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      options.signal?.removeEventListener('abort', abort);
      frame.contentWindow?.postMessage({ type: 'stop', runId }, '*');
      frame.remove();
    };
    const finish = (error?: string) => { cleanup(); resolve({ outputs, error }); };
    const abort = () => { cleanup(); reject(new DOMException('Stopped', 'AbortError')); };
    const receive = (event: MessageEvent) => {
      if (settled || event.source !== frame.contentWindow || event.data?.runId !== runId) return;
      const data = event.data;
      if (data.type === 'done') return finish(typeof data.error === 'string' ? data.error.slice(0, 10000) : undefined);
      if (data.type !== 'output' || !['stdout', 'stderr', 'status', 'image'].includes(data.output?.kind)) return;
      const output: RunOutput = { kind: data.output.kind };
      if (typeof data.output.text === 'string') output.text = data.output.text.slice(0, 20000);
      if (typeof data.output.dataUrl === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(data.output.dataUrl)) output.dataUrl = data.output.dataUrl.slice(0, 2_000_000);
      totalSize += (output.text?.length ?? 0) + (output.dataUrl?.length ?? 0);
      if (totalSize > 4_000_000 || outputs.length >= 500) return finish('Output limit reached. Reduce the amount of output and run again.');
      outputs.push(output);
      options.onOutput?.(output);
    };
    const timer = setTimeout(() => finish('Execution timed out after 90 seconds. The sandbox was stopped.'), 90000);
    window.addEventListener('message', receive);
    options.signal?.addEventListener('abort', abort, { once: true });
    frame.onload = () => frame.contentWindow?.postMessage({
      type: 'run', runId, language: options.language, code: options.code,
    }, '*');
    document.body.append(frame);
  });
}
