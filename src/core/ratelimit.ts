/**
 * Token-bucket rate limiter for Tier 2 lookups, with an exponential backoff ladder and a circuit
 * breaker. Tier 2 traffic is the only thing Botdar adds to the user's session, so a platform that
 * starts throttling must be backed off quickly to keep the user's own account out of trouble.
 */

const MILLISECONDS_PER_MINUTE = 60_000;

/** Delay applied on the n-th consecutive rate-limit report; the last rung repeats. */
export const BACKOFF_LADDER_MS: readonly number[] = [1_000, 4_000, 16_000, 64_000, 300_000];

/**
 * Ceiling for any single circuit opening, including server-supplied Retry-After values, so a hostile
 * or buggy header cannot park the limiter for hours.
 */
export const MAX_BACKOFF_MS = 300_000;

export interface RateLimiterOptions {
  perMinute: number;
  burst: number;
  now?: () => number;
}

/** Thrown by active sources when the platform answered with a rate-limit status. */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RateLimitedError";
  }
}

export class RateLimiter {
  private readonly refillPerMs: number;
  private readonly burst: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefillAt: number;
  private consecutiveRateLimits = 0;
  private circuitOpenUntil = 0;

  constructor({ perMinute, burst, now = Date.now }: RateLimiterOptions) {
    if (!(perMinute > 0) || !(burst >= 1)) {
      throw new RangeError(
        `RateLimiter needs perMinute > 0 and burst >= 1, got ${perMinute}/${burst}`,
      );
    }
    this.refillPerMs = perMinute / MILLISECONDS_PER_MINUTE;
    this.burst = burst;
    this.now = now;
    this.tokens = burst;
    this.lastRefillAt = now();
  }

  /**
   * Consumes `count` tokens at once when that many are available and the circuit is closed, so a
   * lookup that makes several calls runs whole or not at all. A count above the burst never fits.
   */
  tryAcquire(count = 1): boolean {
    if (this.isOpen()) {
      return false;
    }
    this.refill();
    if (this.tokens < count) {
      return false;
    }
    this.tokens -= count;
    return true;
  }

  /** Opens the circuit for the next rung of the ladder, or longer when the platform asked for it. */
  reportRateLimited(retryAfterMs?: number): void {
    const rungIndex: number = Math.min(this.consecutiveRateLimits, BACKOFF_LADDER_MS.length - 1);
    const ladderDelayMs: number = BACKOFF_LADDER_MS[rungIndex] ?? MAX_BACKOFF_MS;
    const requestedDelayMs: number = Math.max(ladderDelayMs, retryAfterMs ?? 0);
    const delayMs: number = Math.min(requestedDelayMs, MAX_BACKOFF_MS);
    this.circuitOpenUntil = Math.max(this.circuitOpenUntil, this.now() + delayMs);
    this.consecutiveRateLimits += 1;
    // A rate-limited response proves the platform's budget is spent: drop the local one too and
    // only start refilling once the circuit closes.
    this.tokens = 0;
    this.lastRefillAt = this.circuitOpenUntil;
  }

  /** A successful lookup resets the ladder so the next throttle starts from the shortest rung. */
  reportSuccess(): void {
    this.consecutiveRateLimits = 0;
  }

  isOpen(): boolean {
    return this.now() < this.circuitOpenUntil;
  }

  /** Earliest time `tryAcquire(count)` can succeed; the current time when it would succeed now. */
  nextAllowedAt(count = 1): number {
    const currentTime: number = this.now();
    if (currentTime < this.circuitOpenUntil) {
      return this.circuitOpenUntil;
    }
    this.refill();
    if (this.tokens >= count) {
      return currentTime;
    }
    return currentTime + Math.ceil((count - this.tokens) / this.refillPerMs);
  }

  private refill(): void {
    const currentTime: number = this.now();
    const elapsedMs: number = Math.max(0, currentTime - this.lastRefillAt);
    this.tokens = Math.min(this.burst, this.tokens + elapsedMs * this.refillPerMs);
    this.lastRefillAt = currentTime;
  }
}
