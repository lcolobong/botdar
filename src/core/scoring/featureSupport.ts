/**
 * Helpers every platform's `toFeatures` shares: the day length the rates divide by, the tier a
 * feature is attributed to, and the age gate the karma-rate features use on Reddit and Hacker News.
 */
import type { AccountSignals, SignalField, SourceTier } from "../types";

export const DAY_MILLIS = 86_400_000;

/**
 * On an account older than this, years of ordinary use dilute a karma rate until it says nothing
 * (docs/scoring-spec.md, "Activity rate"), so `reddit.karmaPerDay` and `hn.karmaPerDay` are gated
 * below it.
 */
export const KARMA_RATE_MAX_AGE_DAYS = 180;

/** The most expensive tier among the fields a feature reads; fields with no record count as DOM. */
export function tierOf(signals: AccountSignals, fields: SignalField[]): SourceTier {
  let highest: SourceTier = 0;
  for (const field of fields) {
    const tier: SourceTier | undefined = signals.provenance[field];
    if (tier !== undefined && tier > highest) {
      highest = tier;
    }
  }
  return highest;
}
