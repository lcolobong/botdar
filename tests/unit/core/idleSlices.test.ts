import type { ShouldYield, SliceScheduler } from "@/src/core/idleSlices";
import { SLICE_BUDGET_MS, createSliceScheduler, drainQueue } from "@/src/core/idleSlices";

type IdleCallback = (deadline?: IdleDeadline) => void;

/** A host whose idle callbacks run only when the test hands them a deadline. */
function idleHost(clock: { now: number }): {
  view: Parameters<typeof createSliceScheduler>[0];
  pending: IdleCallback[];
  requestIdleCallback: ReturnType<typeof vi.fn>;
} {
  const pending: IdleCallback[] = [];
  const requestIdleCallback = vi.fn((callback: IdleCallback): number => {
    pending.push(callback);
    return pending.length;
  });
  const view = {
    requestIdleCallback,
    cancelIdleCallback: vi.fn(),
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
    performance: { now: () => clock.now },
  } as unknown as Parameters<typeof createSliceScheduler>[0];
  return { view, pending, requestIdleCallback };
}

const deadline = (timeRemaining: number, didTimeout = false): IdleDeadline => ({
  didTimeout,
  timeRemaining: () => timeRemaining,
});

/** Work that costs `costMs` of the fake clock per item. */
function costlyWork(
  clock: { now: number },
  items: number[],
  costMs: number,
): { processed: number[]; work: (shouldYield: ShouldYield) => boolean } {
  const queue = new Set<number>(items);
  const processed: number[] = [];
  return {
    processed,
    work: (shouldYield) =>
      drainQueue(
        queue,
        (item) => {
          clock.now += costMs;
          processed.push(item);
        },
        shouldYield,
      ),
  };
}

describe("drainQueue", () => {
  it("takes items in insertion order until told to yield, at least one per call", () => {
    const queue = new Set<string>(["a", "b", "c"]);
    const seen: string[] = [];

    expect(
      drainQueue(
        queue,
        (item) => seen.push(item),
        () => true,
      ),
    ).toBe(true);
    expect(seen).toEqual(["a"]);
    expect(
      drainQueue(
        queue,
        (item) => seen.push(item),
        () => false,
      ),
    ).toBe(false);
    expect(seen).toEqual(["a", "b", "c"]);
    expect(queue.size).toBe(0);
  });
});

describe("createSliceScheduler", () => {
  it("asks for an idle callback with the timeout and coalesces requests", () => {
    const clock = { now: 0 };
    const { view, requestIdleCallback } = idleHost(clock);
    const scheduler: SliceScheduler = createSliceScheduler(view, 150, () => false);

    scheduler.schedule();
    scheduler.schedule();

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 150 });
  });

  it("stops a slice when the idle period runs out and schedules the rest", () => {
    const clock = { now: 0 };
    const { view, pending } = idleHost(clock);
    const { processed, work } = costlyWork(clock, [1, 2, 3, 4, 5], 2);
    const scheduler: SliceScheduler = createSliceScheduler(view, 150, work);

    scheduler.schedule();
    pending.shift()?.(deadline(5));

    expect(processed).toEqual([1, 2, 3]);
    expect(pending).toHaveLength(1);
    pending.shift()?.(deadline(50));
    expect(processed).toEqual([1, 2, 3, 4, 5]);
    expect(pending).toHaveLength(0);
  });

  it("never runs a slice longer than the budget, even in a long idle period", () => {
    const clock = { now: 0 };
    const { view, pending } = idleHost(clock);
    const { processed, work } = costlyWork(
      clock,
      Array.from({ length: 100 }, (_, i) => i),
      1,
    );
    const scheduler: SliceScheduler = createSliceScheduler(view, 150, work);

    scheduler.schedule();
    pending.shift()?.(deadline(50));

    expect(processed).toHaveLength(SLICE_BUDGET_MS);
  });

  it("gives a slice the fixed budget when the timeout fired", () => {
    const clock = { now: 0 };
    const { view, pending } = idleHost(clock);
    const { processed, work } = costlyWork(
      clock,
      Array.from({ length: 100 }, (_, i) => i),
      1,
    );
    const scheduler: SliceScheduler = createSliceScheduler(view, 150, work);

    scheduler.schedule();
    pending.shift()?.(deadline(0, true));

    expect(processed).toHaveLength(SLICE_BUDGET_MS);
    expect(pending).toHaveLength(1);
  });

  it("runs another slice when work was requested while one was running", () => {
    const clock = { now: 0 };
    const { view, pending } = idleHost(clock);
    let runs = 0;
    const scheduler: SliceScheduler = createSliceScheduler(view, 150, () => {
      runs += 1;
      if (runs === 1) scheduler.schedule();
      return false;
    });

    scheduler.schedule();
    pending.shift()?.(deadline(10));
    pending.shift()?.(deadline(10));

    expect(runs).toBe(2);
    expect(pending).toHaveLength(0);
  });

  it("falls back to a timer: the timeout first, then the next turn for continuations", () => {
    vi.useFakeTimers();
    const clock = { now: 0 };
    const view = {
      setTimeout: (callback: () => void, delay: number): number =>
        setTimeout(callback, delay) as unknown as number,
      clearTimeout: (handle: number): void => clearTimeout(handle),
      performance: { now: () => clock.now },
    } as unknown as Parameters<typeof createSliceScheduler>[0];
    const { processed, work } = costlyWork(clock, [1, 2, 3], SLICE_BUDGET_MS);
    const scheduler: SliceScheduler = createSliceScheduler(view, 150, work);

    scheduler.schedule();
    vi.advanceTimersByTime(149);
    expect(processed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(processed).toEqual([1]);
    vi.advanceTimersToNextTimer();
    expect(processed).toEqual([1, 2]);
    vi.advanceTimersToNextTimer();
    expect(processed).toEqual([1, 2, 3]);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("runs a slice synchronously on runNow and does nothing after dispose", () => {
    const clock = { now: 0 };
    const { view, pending } = idleHost(clock);
    const { processed, work } = costlyWork(clock, [1, 2], SLICE_BUDGET_MS);
    const scheduler: SliceScheduler = createSliceScheduler(view, 150, work);

    scheduler.runNow();
    expect(processed).toEqual([1]);
    expect(pending).toHaveLength(1);

    scheduler.dispose();
    pending.shift()?.(deadline(50));
    scheduler.schedule();
    expect(processed).toEqual([1]);
    expect(pending).toHaveLength(0);
  });
});
