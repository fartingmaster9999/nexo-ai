export type RunLanguage = 'python' | 'javascript' | 'html';
export type RunOutput = { kind: 'stdout' | 'stderr' | 'status' | 'image'; text?: string; dataUrl?: string };
export type ExecutionResult = { outputs: RunOutput[]; error?: string; previewHtml?: string };

/** HTML previews MUST also use an iframe with sandbox="allow-scripts", never allow-same-origin. */
export function makePreviewHtml(code: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src data: blob: https:; connect-src https://cdn.jsdelivr.net; form-action 'none'; base-uri 'none'; frame-src 'none'";
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1">${code}`;
}

/** Untrusted code runs in an opaque-origin iframe and worker, never on the application server. */
type ExecuteOptions = {
  language: RunLanguage;
  code: string;
  onOutput?: (output: RunOutput) => void;
  signal?: AbortSignal;
};

let runnerFrame: HTMLIFrameElement | null = null;
let runnerFramePromise: Promise<HTMLIFrameElement> | null = null;
let runQueue: Promise<unknown> = Promise.resolve();

function getRunnerFrame(): Promise<HTMLIFrameElement> {
  if (runnerFrame?.isConnected && runnerFrame.contentWindow) return Promise.resolve(runnerFrame);
  if (runnerFramePromise) return runnerFramePromise;

  const frame = document.createElement('iframe');
  frame.sandbox.add('allow-scripts');
  frame.hidden = true;
  frame.title = 'Isolated code runner';
  frame.setAttribute('aria-hidden', 'true');

  let resolveFrame!: (value: HTMLIFrameElement) => void;
  let rejectFrame!: (reason: Error) => void;
  let settled = false;
  let loadTimer: number;
  const loading = new Promise<HTMLIFrameElement>((resolve, reject) => {
    resolveFrame = resolve;
    rejectFrame = reject;
  });
  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(loadTimer);
    frame.onload = null;
    frame.onerror = null;
    frame.remove();
    rejectFrame(new Error(message));
  };
  frame.onload = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(loadTimer);
    runnerFrame = frame;
    resolveFrame(frame);
  };
  frame.onerror = () => fail('The code sandbox failed to load. Check your connection and try again.');
  loadTimer = window.setTimeout(() => fail('The code sandbox took too long to load. Check your connection and try again.'), 15000);
  frame.src = `${import.meta.env.BASE_URL}code-runner.html`;
  document.body.append(frame);

  let tracked: Promise<HTMLIFrameElement>;
  tracked = loading.finally(() => {
    if (runnerFramePromise === tracked) runnerFramePromise = null;
  });
  runnerFramePromise = tracked;
  return tracked;
}

function executeInRunner(options: ExecuteOptions): Promise<ExecutionResult> {
  if (options.signal?.aborted) return Promise.reject(new DOMException('Stopped', 'AbortError'));
  return new Promise((resolve, reject) => {
    const runId = crypto.randomUUID();
    const outputs: RunOutput[] = [];
    let totalSize = 0;
    let settled = false;
    let frame: HTMLIFrameElement | null = null;
    let timer: number;
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', receive);
      options.signal?.removeEventListener('abort', abort);
    };
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ outputs, error });
    };
    const abort = () => {
      if (settled) return;
      frame?.contentWindow?.postMessage({ type: 'stop', runId }, '*');
      settled = true;
      cleanup();
      reject(new DOMException('Stopped', 'AbortError'));
    };
    const receive = (event: MessageEvent) => {
      if (settled || event.source !== frame?.contentWindow || event.data?.runId !== runId) return;
      const data = event.data;
      if (data.type === 'done') return finish(typeof data.error === 'string' ? data.error.slice(0, 10000) : undefined);
      if (data.type !== 'output' || !['stdout', 'stderr', 'status', 'image'].includes(data.output?.kind)) return;
      const output: RunOutput = { kind: data.output.kind };
      if (typeof data.output.text === 'string') output.text = data.output.text.slice(0, 20000);
      if (typeof data.output.dataUrl === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(data.output.dataUrl)) output.dataUrl = data.output.dataUrl.slice(0, 2_000_000);
      totalSize += (output.text?.length ?? 0) + (output.dataUrl?.length ?? 0);
      if (totalSize > 4_000_000 || outputs.length >= 500) {
        frame?.contentWindow?.postMessage({ type: 'stop', runId }, '*');
        return finish('Output limit reached. Reduce the amount of output and run again.');
      }
      outputs.push(output);
      options.onOutput?.(output);
    };
    window.addEventListener('message', receive);
    options.signal?.addEventListener('abort', abort, { once: true });
    timer = window.setTimeout(() => {
      frame?.contentWindow?.postMessage({ type: 'stop', runId }, '*');
      finish('Execution timed out after 90 seconds. The sandbox was stopped.');
    }, 90000);
    getRunnerFrame().then((readyFrame) => {
      frame = readyFrame;
      if (settled) return;
      if (options.signal?.aborted) return abort();
      frame.contentWindow?.postMessage({ type: 'run', runId, language: options.language, code: options.code }, '*');
    }).catch((error: unknown) => {
      finish(error instanceof Error ? error.message : 'The code sandbox failed to start.');
    });
  });
}

export function executeCode(options: ExecuteOptions): Promise<ExecutionResult> {
  if (options.signal?.aborted) return Promise.reject(new DOMException('Stopped', 'AbortError'));
  if (options.language === 'html') return Promise.resolve({ outputs: [], previewHtml: makePreviewHtml(options.code) });
  const next = runQueue.then(() => executeInRunner(options), () => executeInRunner(options));
  runQueue = next.then(() => undefined, () => undefined);
  return next;
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    runnerFrame?.remove();
    runnerFrame = null;
    runnerFramePromise = null;
  });
}
