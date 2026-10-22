import {
  BACKOFF_LADDER_MS,
  MAX_BACKOFF_MS,
  RateLimitedError,
  RateLimiter,
} from "@/src/core/ratelimit";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeLimiter = (): RateLimiter => new RateLimiter({ perMinute: 60, burst: 3 });

  describe("token bucket", () => {
    it("allows up to the burst immediately, then refuses", () => {
      const limiter = makeLimiter();
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });

    it("refills at the per-minute rate", () => {
      const limiter = makeLimiter();
      limiter.tryAcquire();
      limiter.tryAcquire();
      limiter.tryAcquire();
      vi.advanceTimersByTime(999);
      expect(limiter.tryAcquire()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(limiter.tryAcquire()).toBe(true);
    });

    it("never refills above the burst", () => {
      const limiter = makeLimiter();
      vi.advanceTimersByTime(60_000);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });

    it("reports when the next token becomes available", () => {
      const limiter = makeLimiter();
      const start: number = Date.now();
      expect(limiter.nextAllowedAt()).toBe(start);
      limiter.tryAcquire();
      limiter.tryAcquire();
      limiter.tryAcquire();
      expect(limiter.nextAllowedAt()).toBe(start + 1000);
      vi.advanceTimersByTime(400);
      expect(limiter.nextAllowedAt()).toBe(start + 1000);
    });

    it("rejects an invalid configuration", () => {
      expect(() => new RateLimiter({ perMinute: 0, burst: 1 })).toThrow(RangeError);
      expect(() => new RateLimiter({ perMinute: 10, burst: 0 })).toThrow(RangeError);
    });
  });

  describe("backoff ladder and circuit breaker", () => {
    it("opens the circuit for 1 s on the first rate-limit report", () => {
      const limiter = makeLimiter();
      const start: number = Date.now();
      limiter.reportRateLimited();
      expect(limiter.isOpen()).toBe(true);
      expect(limiter.nextAllowedAt()).toBe(start + 1000);
      expect(limiter.tryAcquire()).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(limiter.isOpen()).toBe(false);
    });

    it("climbs the ladder 1 s, 4 s, 16 s, 64 s, 5 min and stays at 5 min", () => {
      const limiter = makeLimiter();
      const expected: number[] = [...BACKOFF_LADDER_MS, MAX_BACKOFF_MS];
      for (const delayMs of expected) {
        const reportedAt: number = Date.now();
        limiter.reportRateLimited();
        expect(limiter.nextAllowedAt()).toBe(reportedAt + delayMs);
        vi.advanceTimersByTime(delayMs);
        expect(limiter.isOpen()).toBe(false);
      }
    });

    it("honours a longer Retry-After, capped at 5 minutes", () => {
      const limiter = makeLimiter();
      const start: number = Date.now();
      limiter.reportRateLimited(30_000);
      expect(limiter.nextAllowedAt()).toBe(start + 30_000);
      vi.advanceTimersByTime(30_000);
      limiter.reportRateLimited(3_600_000);
      expect(limiter.nextAllowedAt()).toBe(start + 30_000 + MAX_BACKOFF_MS);
    });

    it("ignores a Retry-After shorter than the ladder rung", () => {
      const limiter = makeLimiter();
      const start: number = Date.now();
      limiter.reportRateLimited(100);
      expect(limiter.nextAllowedAt()).toBe(start + 1000);
    });

    it("resets the ladder after a success", () => {
      const limiter = makeLimiter();
      limiter.reportRateLimited();
      vi.advanceTimersByTime(1000);
      limiter.reportRateLimited();
      vi.advanceTimersByTime(4000);
      limiter.reportSuccess();
      const reportedAt: number = Date.now();
      limiter.reportRateLimited();
      expect(limiter.nextAllowedAt()).toBe(reportedAt + 1000);
    });

    it("drains the bucket and only refills once the circuit closes", () => {
      const limiter = makeLimiter();
      limiter.reportRateLimited();
      vi.advanceTimersByTime(1000);
      expect(limiter.tryAcquire()).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });
  });

  describe("RateLimitedError", () => {
    it("carries an optional retry-after hint", () => {
      const error = new RateLimitedError("429 from x.com", 5000);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("RateLimitedError");
      expect(error.retryAfterMs).toBe(5000);
      expect(new RateLimitedError("429").retryAfterMs).toBeUndefined();
    });
  });
});
