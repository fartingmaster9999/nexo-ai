export const FEEDBACK_CATALOG_MS = 3_000;
export const FEEDBACK_PLANNING_MS = 5_000;
export const FEEDBACK_REVIEW_MS = 12_000;

export class FeedbackTimeoutError extends Error {
  constructor() {
    super("Optional feedback exceeded its time budget.");
    this.name = "FeedbackTimeoutError";
  }
}

/** Hard elapsed-time budget, even when an upstream adapter ignores cancellation. */
export async function withFeedbackBudget<T>(
  work: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  parent.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      controller.abort(parent.reason);
      reject(parent.reason);
    };
    parent.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      const reason = new FeedbackTimeoutError();
      controller.abort(reason);
      reject(reason);
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([cancelled, Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    })]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
