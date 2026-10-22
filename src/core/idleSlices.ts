/**
 * Work-capped idle scheduling for the feed observers (docs/performance.md, hotspot 2). A pass that
 * analyses every pending post in one task turns into a long task on a big thread, and on a busy page
 * the idle callback's timeout makes it an ordinary task anyway. Instead each slice runs until its
 * budget is spent, then yields and schedules the rest.
 */

/** Longest a slice keeps working; well under the 50 ms at which a task counts as long. */
export const SLICE_BUDGET_MS = 8;

/**
 * Longest a requested slice waits for an idle period before it runs anyway, and the plain timer's
 * delay where requestIdleCallback is missing. The first badges land well inside it.
 */
export const IDLE_TIMEOUT_MS = 150;

/** True once the running slice has spent its budget and should hand the main thread back. */
export type ShouldYield = () => boolean;

/** Runs one slice of work; returns whether work is left for another slice. */
export type SliceWork = (shouldYield: ShouldYield) => boolean;

export interface SliceScheduler {
  /** Asks for a slice. A no-op while one is pending; inside a running slice it asks for another. */
  schedule: () => void;
  /** Runs a slice synchronously now, then schedules the remainder. */
  runNow: () => void;
  /** Cancels the pending slice; later calls do nothing. */
  dispose: () => void;
}

type IdleHost = Pick<Window, "setTimeout" | "clearTimeout" | "performance"> & {
  requestIdleCallback?: (
    callback: (deadline?: IdleDeadline) => void,
    options: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * A deadline that fired on its timeout reports no time remaining, and a plain timer has no
 * deadline at all; both still get the fixed budget so the slice makes progress. An idle period
 * longer than the budget is not used in full, because the badge mounts that follow a slice run in
 * the same task.
 */
function yieldAfterBudget(deadline: IdleDeadline | undefined, now: () => number): ShouldYield {
  const budgetMs: number =
    deadline === undefined || deadline.didTimeout
      ? SLICE_BUDGET_MS
      : Math.min(deadline.timeRemaining(), SLICE_BUDGET_MS);
  const endsAt: number = now() + budgetMs;
  return () => now() >= endsAt;
}

/**
 * Schedules `work` in idle time with `timeoutMs` as the idle callback's timeout. Without
 * requestIdleCallback the first slice waits `timeoutMs` on a timer and continuations follow on the
 * next turn of the event loop.
 */
export function createSliceScheduler(
  view: IdleHost,
  timeoutMs: number,
  work: SliceWork,
  now: () => number = () => view.performance.now(),
): SliceScheduler {
  let pending = false;
  let cancelPending: (() => void) | undefined;
  let running = false;
  let requestedWhileRunning = false;
  let disposed = false;

  const run = (deadline?: IdleDeadline): void => {
    pending = false;
    cancelPending = undefined;
    if (disposed || running) return;
    running = true;
    requestedWhileRunning = false;
    let workLeft: boolean;
    // A slice that throws must not leave `running` set, or every later request would be swallowed.
    try {
      workLeft = work(yieldAfterBudget(deadline, now));
    } finally {
      running = false;
    }
    if (workLeft || requestedWhileRunning) request(true);
  };

  const request = (continuation: boolean): void => {
    if (pending || disposed) return;
    pending = true;
    if (typeof view.requestIdleCallback === "function") {
      const handle: number = view.requestIdleCallback(run, { timeout: timeoutMs });
      // A host that runs the callback synchronously has already cleared `pending`.
      if (pending) cancelPending = () => view.cancelIdleCallback?.(handle);
    } else {
      const handle: number = view.setTimeout(run, continuation ? 0 : timeoutMs);
      if (pending) cancelPending = () => view.clearTimeout(handle);
    }
  };

  return {
    schedule: () => {
      if (running) {
        requestedWhileRunning = true;
        return;
      }
      request(false);
    },
    runNow: () => {
      cancelPending?.();
      run();
    },
    dispose: () => {
      disposed = true;
      cancelPending?.();
      cancelPending = undefined;
      pending = false;
    },
  };
}

/**
 * Takes items off the front of `queue` until the slice should yield, always at least one so every
 * slice makes progress. Returns whether items are left.
 */
export function drainQueue<T>(
  queue: Set<T>,
  process: (item: T) => void,
  shouldYield: ShouldYield,
): boolean {
  for (const item of queue) {
    queue.delete(item);
    process(item);
    if (shouldYield()) break;
  }
  return queue.size > 0;
}
