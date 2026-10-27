/**
 * Helpers every platform's `toFeatures` shares: the day length the rates divide by, the tier a
 * feature is attributed to, the age gate the karma-rate features use on Reddit and Hacker News, and
 * the two coordination features every platform reads from its thread index.
 */
import type { AccountSignals, Feature, FeatureId, SignalField, SourceTier } from "../types";

export const DAY_MILLIS = 86_400_000;

/**
 * On an account older than this, years of ordinary use dilute a karma rate until it says nothing
 * (docs/scoring-spec.md, "Activity rate"), so `reddit.karmaPerDay` and `hn.karmaPerDay` are gated
 * below it. `reddit.karmaSinceFirstActivity` takes the other side of the line, from the first
 * activity instead of the join date.
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

export const NEAR_DUPLICATE_REPLY_FEATURE: FeatureId = "thread.nearDuplicateReply";

/**
 * How many other accounts posted a near copy of the account's reply earlier in the same thread
 * (ADR-0027), from the page's thread index; omitted when the account has no reply on the page long
 * enough to compare. Every reply it reads is on the page, so it is Tier 0 evidence.
 */
export function nearDuplicateReplyFeatures(copiedReplies: number | undefined): Feature[] {
  return copiedReplies === undefined
    ? []
    : [{ id: NEAR_DUPLICATE_REPLY_FEATURE, value: copiedReplies, group: "coordination", tier: 0 }];
}

export const SHARED_RARE_DOMAIN_FEATURE: FeatureId = "thread.sharedRareDomain";

/**
 * How many other accounts linked the same rare domain earlier in the same thread as one of the
 * account's replies (ADR-0029), from the page's thread index; omitted when none of the account's
 * replies on the page links a domain that counts. `linkTier` is the tier that resolved the links:
 * 0 where the page shows them, 1 on X, whose page shows only t.co.
 */
export function sharedRareDomainFeatures(
  otherLinkers: number | undefined,
  linkTier: SourceTier,
): Feature[] {
  return otherLinkers === undefined
    ? []
    : [
        {
          id: SHARED_RARE_DOMAIN_FEATURE,
          value: otherLinkers,
          group: "coordination",
          tier: linkTier,
        },
      ];
}
