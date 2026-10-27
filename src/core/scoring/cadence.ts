/**
 * Posting-cadence statistics for the timing features (docs/adversarial-evasion.md 4.2,
 * docs/scoring-spec.md "Posting cadence"). Pure functions over post timestamps in epoch
 * milliseconds, newest first and at most 100, the form `normalisePostTimestamps` gives them and the
 * pipeline keeps them in; each returns undefined when its gate is not met, so the platform's
 * toFeatures can omit the feature. Human posting is bursty and heavy-tailed, so the gaps between a
 * person's posts vary by more than their mean (a coefficient of variation above 1) and a person's
 * day has hours without posts; schedulers and throttles post on a clock, round the clock.
 */

import type { AccountSignals } from "../types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURS_PER_DAY = 24;

/** Both statistics read the newest posts only, the most a profile timeline page returns. */
export const MAX_CADENCE_POSTS = 100;
/** A gap this long is an absence (a holiday, a break), not part of the rhythm. */
const MAX_GAP_MS = 7 * DAY_MS;
const GAP_MIN_COUNT = 30;
const GAP_MIN_SPAN_MS = 3 * DAY_MS;
/** At 50 uniformly random posts about three hours stay empty by chance; 100 posts make it rare. */
const SLEEP_WINDOW_MIN_POSTS = 100;
const SLEEP_WINDOW_MIN_SPAN_MS = 7 * DAY_MS;

/**
 * A post time this far past the local clock is still believed (clocks drift); anything later is a
 * client-written date that cannot be true, such as a post pinned to the top by dating it 2099.
 */
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

/**
 * The one place post times are cleaned: finite, not in the future, distinct, newest first, the
 * newest 100. Parsers hand over what a body carried; the pipeline normalises when it merges, and
 * the statistics below trust the result.
 */
export function normalisePostTimestamps(timestamps: readonly number[], now: number): number[] {
  const believable: number[] = timestamps.filter(
    (timestamp) => Number.isFinite(timestamp) && timestamp <= now + MAX_CLOCK_SKEW_MS,
  );
  return [...new Set(believable)].sort((newer, older) => older - newer).slice(0, MAX_CADENCE_POSTS);
}

export interface Cadence {
  gapCoefficientOfVariation?: number;
  longestEmptyHourRun?: number;
}

/**
 * Both statistics for an account, each only when its gate is met. Accounts verified as an
 * organisation or a government are left out entirely (adversarial-evasion.md 4.2): newsrooms and
 * agencies publish on a schedule and round the clock by design. So is an account that declared
 * itself automated: the declaration already decided its verdict, and its card should not argue it.
 */
export function cadenceOf(
  signals: Pick<AccountSignals, "postTimestamps" | "verified" | "declaredAutomated">,
): Cadence {
  if (
    signals.postTimestamps === undefined ||
    signals.verified === "org" ||
    signals.verified === "gov" ||
    signals.declaredAutomated === true
  ) {
    return {};
  }
  const cadence: Cadence = {};
  const variation: number | undefined = gapCoefficientOfVariation(signals.postTimestamps);
  if (variation !== undefined) {
    cadence.gapCoefficientOfVariation = variation;
  }
  const emptyHours: number | undefined = longestEmptyHourRun(signals.postTimestamps);
  if (emptyHours !== undefined) {
    cadence.longestEmptyHourRun = emptyHours;
  }
  return cadence;
}

/**
 * Standard deviation over mean of the gaps between consecutive posts (newest first, at most 100),
 * gaps over seven days dropped. Undefined below 30 gaps or when the kept gaps span under three days.
 */
export function gapCoefficientOfVariation(posts: readonly number[]): number | undefined {
  const gaps: number[] = [];
  for (let index = 1; index < posts.length; index += 1) {
    const gap: number = (posts[index - 1] ?? 0) - (posts[index] ?? 0);
    if (gap <= MAX_GAP_MS) {
      gaps.push(gap);
    }
  }
  const span: number = gaps.reduce((sum, gap) => sum + gap, 0);
  if (gaps.length < GAP_MIN_COUNT || span < GAP_MIN_SPAN_MS) {
    return undefined;
  }
  const mean: number = span / gaps.length;
  const variance: number = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance) / mean;
}

/**
 * The longest run of consecutive UTC hours of the day in which none of the posts (newest first, at
 * most 100) fell, wrapping past midnight. Undefined below 100 posts or when they span under seven days.
 */
export function longestEmptyHourRun(posts: readonly number[]): number | undefined {
  const newest: number | undefined = posts[0];
  const oldest: number | undefined = posts.at(-1);
  if (
    posts.length < SLEEP_WINDOW_MIN_POSTS ||
    newest === undefined ||
    oldest === undefined ||
    newest - oldest < SLEEP_WINDOW_MIN_SPAN_MS
  ) {
    return undefined;
  }
  const postsByHour: number[] = new Array<number>(HOURS_PER_DAY).fill(0);
  for (const timestamp of posts) {
    const hour: number = new Date(timestamp).getUTCHours();
    postsByHour[hour] = (postsByHour[hour] ?? 0) + 1;
  }
  // Walking the day twice finds a run that wraps past midnight; with at least one hour holding a
  // post, no run can count an hour twice.
  let longest = 0;
  let current = 0;
  for (let step = 0; step < 2 * HOURS_PER_DAY; step += 1) {
    current = postsByHour[step % HOURS_PER_DAY] === 0 ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}
