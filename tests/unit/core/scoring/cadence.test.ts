import {
  MAX_CADENCE_POSTS,
  normalisePostTimestamps,
  gapCoefficientOfVariation,
  longestEmptyHourRun,
} from "@/src/core/scoring/cadence";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const START = Date.UTC(2026, 9, 1, 0, 0, 0);
/** Later than every synthetic post, so normalising drops nothing as "in the future". */
const LATER = Date.UTC(2027, 0, 1);

/** The statistics take post times as the pipeline keeps them: normalised, newest first. */
const cvOf = (timestamps: number[]): number | undefined =>
  gapCoefficientOfVariation(normalisePostTimestamps(timestamps, LATER));
const emptyHoursOf = (timestamps: number[]): number | undefined =>
  longestEmptyHourRun(normalisePostTimestamps(timestamps, LATER));

/** Deterministic uniform numbers in [0, 1), so the synthetic series are stable across runs. */
function seededRandom(seed: number): () => number {
  let state: number = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed: number = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A scheduler: one post every `intervalMs`, optionally with uniform jitter of ± `jitterMs`. */
function metronomic(count: number, intervalMs: number, jitterMs = 0, seed = 1): number[] {
  const random: () => number = seededRandom(seed);
  return Array.from(
    { length: count },
    (_, index) => START + index * intervalMs + (random() * 2 - 1) * jitterMs,
  );
}

/** Round the clock at random: exponential gaps, no daily rhythm. */
function poisson(count: number, meanGapMs: number, seed = 2): number[] {
  const random: () => number = seededRandom(seed);
  const timestamps: number[] = [];
  let at: number = START;
  for (let index = 0; index < count; index += 1) {
    at += -Math.log(1 - random()) * meanGapMs;
    timestamps.push(at);
  }
  return timestamps;
}

/**
 * A person: awake 07:00–23:00 UTC, posting in two or three short bursts a day of a few posts
 * minutes apart, asleep (and silent) the rest of the time.
 */
function human(days: number, seed = 3): number[] {
  const random: () => number = seededRandom(seed);
  const timestamps: number[] = [];
  for (let day = 0; day < days; day += 1) {
    const bursts: number = 2 + Math.floor(random() * 2);
    for (let burst = 0; burst < bursts; burst += 1) {
      let at: number = START + day * DAY_MS + (7 + random() * 15) * HOUR_MS;
      const posts: number = 3 + Math.floor(random() * 4);
      for (let post = 0; post < posts; post += 1) {
        at += (1 + random() * 8) * MINUTE_MS;
        timestamps.push(at);
      }
    }
  }
  return timestamps;
}

describe("gapCoefficientOfVariation", () => {
  it("is near zero for a metronomic scheduler", () => {
    expect(cvOf(metronomic(100, 100 * MINUTE_MS))).toBeCloseTo(0, 6);
  });

  it("stays under 0.5 for a jittered throttle", () => {
    const cv: number | undefined = cvOf(metronomic(100, HOUR_MS, 30 * MINUTE_MS));
    expect(cv).toBeGreaterThan(0.1);
    expect(cv).toBeLessThan(0.5);
  });

  it("is about 1 for posting at random round the clock", () => {
    const cv: number | undefined = cvOf(poisson(100, 2 * HOUR_MS));
    expect(cv).toBeGreaterThan(0.8);
    expect(cv).toBeLessThan(1.3);
  });

  it("is well above 1 for bursty human posting", () => {
    expect(cvOf(human(14))).toBeGreaterThan(1.2);
  });

  it("does not depend on order and ignores non-finite values", () => {
    const series: number[] = metronomic(60, 2 * HOUR_MS, 20 * MINUTE_MS);
    const shuffled: number[] = [...series].reverse();
    shuffled.splice(10, 0, Number.NaN, Number.POSITIVE_INFINITY);
    expect(cvOf(shuffled)).toBeCloseTo(cvOf(series) ?? -1, 10);
  });

  it("reads only the newest 100 posts", () => {
    const older: number[] = poisson(200, 2 * HOUR_MS);
    const newerStart: number = (older.at(-1) ?? START) + HOUR_MS;
    const newer: number[] = Array.from(
      { length: MAX_CADENCE_POSTS },
      (_, index) => newerStart + index * 2 * HOUR_MS,
    );
    expect(cvOf([...older, ...newer])).toBeCloseTo(0, 6);
  });

  it("needs 30 gaps", () => {
    expect(cvOf(metronomic(30, 4 * HOUR_MS))).toBeUndefined();
    expect(cvOf(metronomic(31, 4 * HOUR_MS))).toBeDefined();
  });

  it("needs the gaps to span three days", () => {
    expect(cvOf(metronomic(100, 30 * MINUTE_MS))).toBeUndefined();
    expect(cvOf(metronomic(100, 45 * MINUTE_MS))).toBeDefined();
  });

  it("drops gaps over seven days, so a long break neither counts nor spans", () => {
    const beforeBreak: number[] = metronomic(20, 4 * HOUR_MS);
    const afterBreak: number[] = beforeBreak.map((timestamp) => timestamp + 30 * DAY_MS);
    // 38 kept gaps of four hours; the 30-day break is not one of them.
    expect(cvOf([...beforeBreak, ...afterBreak])).toBeCloseTo(0, 6);
    expect(cvOf([START, START + 10 * DAY_MS])).toBeUndefined();
  });

  it("answers nothing for no posts", () => {
    expect(cvOf([])).toBeUndefined();
  });
});

describe("longestEmptyHourRun", () => {
  it("is zero for a scheduler that posts round the clock", () => {
    expect(emptyHoursOf(metronomic(100, 110 * MINUTE_MS, 4 * MINUTE_MS))).toBe(0);
  });

  it("is at most an hour or so for random round-the-clock posting", () => {
    expect(emptyHoursOf(poisson(100, 2 * HOUR_MS))).toBeLessThan(2);
  });

  it("finds a person's sleep trough", () => {
    expect(emptyHoursOf(human(14))).toBeGreaterThanOrEqual(6);
  });

  it("counts a quiet stretch that wraps past midnight as one run", () => {
    // Posts only from 06:00 to 19:59 UTC: ten quiet hours from 20:00 to 05:59.
    const daytime: number[] = Array.from({ length: 100 }, (_, index) => {
      const day: number = Math.floor(index / 10);
      const hour: number = 6 + ((index * 3) % 14);
      return START + day * DAY_MS + hour * HOUR_MS + 17 * MINUTE_MS;
    });
    expect(emptyHoursOf(daytime)).toBe(10);
  });

  it("needs 100 posts", () => {
    expect(emptyHoursOf(metronomic(99, 2 * HOUR_MS))).toBeUndefined();
  });

  it("needs the posts to span seven days", () => {
    expect(emptyHoursOf(metronomic(100, HOUR_MS))).toBeUndefined();
    expect(emptyHoursOf(metronomic(100, 110 * MINUTE_MS))).toBe(0);
  });

  it("reads only the newest 100 posts", () => {
    const roundTheClock: number[] = metronomic(100, 110 * MINUTE_MS);
    const olderDaytime: number[] = Array.from(
      { length: 50 },
      (_, index) => START - (index + 1) * DAY_MS + 12 * HOUR_MS,
    );
    expect(emptyHoursOf([...roundTheClock, ...olderDaytime])).toBe(0);
  });
});

describe("normalisePostTimestamps", () => {
  const now: number = START + 30 * DAY_MS;

  it("keeps distinct finite times, newest first", () => {
    expect(
      normalisePostTimestamps(
        [START, START + HOUR_MS, START, Number.NaN, START + 2 * HOUR_MS],
        now,
      ),
    ).toEqual([START + 2 * HOUR_MS, START + HOUR_MS, START]);
  });

  it("drops times in the future beyond a few minutes of clock drift", () => {
    const pinnedTo2099: number = Date.UTC(2099, 0, 1);
    expect(
      normalisePostTimestamps([now + 5 * MINUTE_MS, now + HOUR_MS, pinnedTo2099, now], now),
    ).toEqual([now + 5 * MINUTE_MS, now]);
  });

  it("keeps the newest 100", () => {
    const posts: number[] = Array.from({ length: 150 }, (_, index) => START + index * HOUR_MS);
    const kept: number[] = normalisePostTimestamps(posts, now);
    expect(kept).toHaveLength(MAX_CADENCE_POSTS);
    expect(kept[0]).toBe(START + 149 * HOUR_MS);
    expect(kept.at(-1)).toBe(START + 50 * HOUR_MS);
  });
});
