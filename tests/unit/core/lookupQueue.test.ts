import { LookupQueue, RETRY_AFTER_REFUSAL_MS } from "@/src/core/lookupQueue";
import { RateLimiter } from "@/src/core/ratelimit";

interface Harness {
  queue: LookupQueue;
  limiter: RateLimiter;
  started: string[];
}

/** One token a second after a burst of two; each run takes its token synchronously. */
function makeHarness(turnAway: Set<string> = new Set()): Harness {
  const limiter = new RateLimiter({ perMinute: 60, burst: 2 });
  const started: string[] = [];
  const queue = new LookupQueue({
    limiter,
    now: Date.now,
    run: async (key: string): Promise<boolean> => {
      if (turnAway.delete(key) || !limiter.tryAcquire()) return false;
      started.push(key);
      return true;
    },
  });
  return { queue, limiter, started };
}

describe("LookupQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the burst at once and the rest one per token, in order", async () => {
    const { queue, started } = makeHarness();
    const done: Array<Promise<void>> = ["a", "b", "c", "d"].map((key) => queue.enqueue(key));
    expect(started).toEqual(["a", "b"]);
    expect(queue.has("c")).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toEqual(["a", "b", "c"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toEqual(["a", "b", "c", "d"]);
    await expect(Promise.all(done)).resolves.toBeDefined();
    expect(queue.has("d")).toBe(false);
  });

  it("returns the same promise for a key queued twice and runs it once", async () => {
    const { queue, started } = makeHarness();
    queue.enqueue("a");
    queue.enqueue("b");
    const first: Promise<void> = queue.enqueue("c");
    expect(queue.enqueue("c")).toBe(first);
    await vi.advanceTimersByTimeAsync(5000);
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("moves a promoted key to the front", async () => {
    const { queue, started } = makeHarness();
    ["a", "b", "c", "d"].forEach((key) => void queue.enqueue(key));
    queue.promote("d");
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toEqual(["a", "b", "d"]);
  });

  it("queues a run the limiter turned away again and retries it after a pause", async () => {
    const { queue, started } = makeHarness(new Set(["a"]));
    const done: Promise<void> = queue.enqueue("a");
    expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_REFUSAL_MS - 1);
    expect(started).toEqual([]);
    expect(queue.has("a")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual(["a"]);
    await expect(done).resolves.toBeUndefined();
  });

  it("never calls a runner that keeps refusing more than once per pause", async () => {
    const limiter = new RateLimiter({ perMinute: 60, burst: 2 });
    const run = vi.fn(async (): Promise<boolean> => false);
    const queue = new LookupQueue({ limiter, now: Date.now, run });
    void queue.enqueue("a");
    for (let tick = 0; tick < 200; tick += 1) await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_REFUSAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(4);
    queue.clear();
  });

  it("drops every waiting key on clear and resolves their promises", async () => {
    const { queue, started } = makeHarness();
    ["a", "b"].forEach((key) => void queue.enqueue(key));
    const waiting: Promise<void> = queue.enqueue("c");
    queue.clear();
    await expect(waiting).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(started).toEqual(["a", "b"]);
  });
});
