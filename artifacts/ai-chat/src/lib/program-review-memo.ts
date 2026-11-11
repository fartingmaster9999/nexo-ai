/**
 * One successful review per exact input, scoped to a single Agent run.
 * Never persist source, images, findings, or credentials in a shared cache.
 */
export function createProgramReviewMemo() {
  let lastInput: string | undefined;
  let lastReview: string | undefined;
  return {
    read(input: unknown): string | undefined {
      return JSON.stringify(input) === lastInput ? lastReview : undefined;
    },
    remember(input: unknown, review: string) {
      if (!review.trim()) return;
      lastInput = JSON.stringify(input);
      lastReview = review;
    },
  };
}
