/**
 * First-in, first-out queue for on-sight Tier 2 lookups (ADR-0020). A lookup the rate limiter
 * cannot serve now waits for the next token instead of being dropped, so every account that comes
 * near the viewport is looked up once, at the limiter's pace, and its badge shows the loading
 * state until then. Accounts are queued in the order they came near, which on a first load is top
 * to bottom; a hover moves its account to the front.
 */
import type { RateLimiter } from "./ratelimit";

export interface LookupQueueOptions {
  limiter: Pick<RateLimiter, "nextAllowedAt">;
  now: () => number;
  /**
   * Starts the lookup for a key and resolves true once it ran, or false when the limiter turned it
   * away after all. It must take its limiter token synchronously, before its first await, so the
   * next `nextAllowedAt` already counts it.
   */
  run: (key: string) => Promise<boolean>;
}

/**
 * How long a run the limiter turned away waits before the queue tries again. Without a pause a
 * runner that keeps answering false while `nextAllowedAt` still says "now" (a limiter that refuses
 * for a reason the bucket does not show) would be called again in the next microtask, forever.
 */
export const RETRY_AFTER_REFUSAL_MS = 1000;

interface Waiter {
  promise: Promise<void>;
  resolve: () => void;
}

export class LookupQueue {
  private readonly options: LookupQueueOptions;
  /** Insertion order is queue order. */
  private waiting = new Map<string, Waiter>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Set after a turned-away run; the queue waits for this as well as for the limiter. */
  private retryNotBefore = 0;

  constructor(options: LookupQueueOptions) {
    this.options = options;
  }

  /** Resolves when the key's lookup has run, or when the key is dropped. */
  enqueue(key: string): Promise<void> {
    const existing: Waiter | undefined = this.waiting.get(key);
    if (existing !== undefined) {
      return existing.promise;
    }
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((resolveWaiter) => (resolve = resolveWaiter));
    this.waiting.set(key, { promise, resolve });
    this.drain();
    return promise;
  }

  has(key: string): boolean {
    return this.waiting.has(key);
  }

  /** Moves a waiting key to the front and runs it now if a token is free. */
  promote(key: string): void {
    const waiter: Waiter | undefined = this.waiting.get(key);
    if (waiter === undefined) {
      return;
    }
    this.waiting.delete(key);
    this.waiting = new Map([[key, waiter], ...this.waiting]);
    this.drain();
  }

  /** Drops every waiting key, resolving its promise without a lookup. */
  clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const dropped: Waiter[] = [...this.waiting.values()];
    this.waiting.clear();
    dropped.forEach((waiter) => waiter.resolve());
  }

  private drain(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.waiting.size > 0) {
      const readyAt: number = Math.max(this.options.limiter.nextAllowedAt(), this.retryNotBefore);
      const waitMs: number = readyAt - this.options.now();
      if (waitMs > 0) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.drain();
        }, waitMs);
        return;
      }
      const [key, waiter] = this.waiting.entries().next().value as [string, Waiter];
      this.waiting.delete(key);
      void this.options.run(key).then(
        (ran: boolean) => (ran ? waiter.resolve() : this.requeue(key, waiter)),
        () => waiter.resolve(),
      );
    }
  }

  /**
   * A run the limiter turned away goes back to the front, unless the key was queued again, and the
   * queue pauses for RETRY_AFTER_REFUSAL_MS before it tries again.
   */
  private requeue(key: string, waiter: Waiter): void {
    if (this.waiting.has(key)) {
      waiter.resolve();
      return;
    }
    this.waiting = new Map([[key, waiter], ...this.waiting]);
    this.retryNotBefore = this.options.now() + RETRY_AFTER_REFUSAL_MS;
    this.drain();
  }
}
