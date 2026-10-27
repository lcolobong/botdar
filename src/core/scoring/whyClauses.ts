/**
 * The short clause after each hover-card reason that says why the observation points the way it
 * does. Each one condenses the mechanism in docs/scoring-spec.md "Why each feature is a signal";
 * when that rationale changes, the clause here changes with it. Clauses describe patterns, never
 * the person, and stay within about eight words so a reason wraps to two lines at most.
 */

import type { FeatureId, ReasonDirection } from "../types";

interface WhyClauses {
  /** Shown when the evidence points towards automation. */
  automated: string;
  /**
   * Shown when it does not: a negative bin, or a value that weighs nothing either way. A feature
   * without one has no ordinary reading (a pattern that is either present or unsaid).
   */
  ordinary?: string;
  /**
   * The "Why this could be wrong" line when this feature leads the read, for a feature whose
   * counter-case is not its group's (reasons.ts falls back to the group's).
   */
  caveat?: string;
}

const POSTING_RATE: WhyClauses = {
  automated: "prolonged hyperactivity",
  ordinary: "a pace a person keeps up",
};
const ACCOUNT_AGE: WhyClauses = {
  automated: "new accounts often replace banned ones",
  ordinary: "outlasted platform enforcement",
};
const FOLLOW_RATIO: WhyClauses = {
  automated: "mass-following nobody returned",
  ordinary: "others opted in",
};
const KARMA_RATE: WhyClauses = {
  automated: "karma-farming pattern",
  ordinary: "a pace ordinary use earns",
};
const SUGGESTED_HANDLE: WhyClauses = { automated: "unchanged suggested handle" };
const PROFILE_EFFORT: WhyClauses = {
  automated: "left as created",
  ordinary: "effort spent on this one account",
};

const REGULAR_GAPS: WhyClauses = { automated: "scheduling tools post on a clock" };
const NO_QUIET_HOURS: WhyClauses = {
  automated: "no daily quiet window",
  caveat: "Shared and team-run accounts post around the clock.",
};
const NEAR_DUPLICATE_REPLY: WhyClauses = {
  automated: "reply templates get reused across accounts",
  caveat: "Popular phrases and memes get repeated by real people.",
};

/** One entry per reason template in reasons.ts; whyClauses.test.ts checks the two lists match. */
const WHY_CLAUSES: Readonly<Record<FeatureId, WhyClauses>> = {
  "x.postsPerDay": POSTING_RATE,
  "bsky.postsPerDay": POSTING_RATE,
  "x.accountAgeDays": ACCOUNT_AGE,
  "reddit.accountAgeDays": ACCOUNT_AGE,
  "bsky.accountAgeDays": ACCOUNT_AGE,
  "x.followingRatio": FOLLOW_RATIO,
  "bsky.followsRatio": FOLLOW_RATIO,
  "x.handleNameDigits": SUGGESTED_HANDLE,
  "x.handleTrailingDigits": SUGGESTED_HANDLE,
  "bsky.handleDigitsOnBskySocial": SUGGESTED_HANDLE,
  "x.handleBigramLL": { automated: "letter pairs no language uses" },
  "x.defaultAvatarEmptyBio": PROFILE_EFFORT,
  "bsky.noAvatarEmptyBio": PROFILE_EFFORT,
  "x.newAndBlue": { automated: "paid for reach before having anything to say" },
  "x.replyShare": {
    automated: "it inserts itself into others' threads",
    ordinary: "starts its own threads too",
  },
  "x.usernameChanges": {
    automated: "bought or repurposed accounts get renamed",
    ordinary: "too few renames to suggest a resale",
  },
  "x.countryLocaleMismatch": { automated: "a persona run from abroad" },
  "x.gapRegularity": REGULAR_GAPS,
  "bsky.gapRegularity": REGULAR_GAPS,
  "x.noSleepWindow": NO_QUIET_HOURS,
  "bsky.noSleepWindow": NO_QUIET_HOURS,
  "thread.nearDuplicateReply": NEAR_DUPLICATE_REPLY,
  "reddit.karmaPerDay": KARMA_RATE,
  "reddit.karmaSinceFirstActivity": {
    ...KARMA_RATE,
    caveat:
      "Long-time readers who start posting in large communities can earn karma quickly. " +
      "Accounts that delete their old posts keep their karma, so the rate can look inflated.",
  },
  "reddit.postToCommentKarma": {
    automated: "reposts earn it without conversation",
    ordinary: "it joins conversations",
  },
  "reddit.generatedName": { automated: "kept as suggested" },
  "reddit.noAvatar": PROFILE_EFFORT,
  "reddit.noVerifiedEmail": {
    automated: "verifying takes a mailbox per account",
    ordinary: "a mailbox sits behind this account",
  },
  "hn.accountAgeDays": ACCOUNT_AGE,
  "hn.karmaPerDay": KARMA_RATE,
  "hn.submissionsPerDay": POSTING_RATE,
  "hn.hasAbout": PROFILE_EFFORT,
};

export const DECLARED_WHY = "self-declared";

/**
 * Positive evidence points towards automation and negative evidence away from it. Evidence that
 * weighs nothing points away too, as the Likely human rule counts it, unless the feature has no
 * ordinary reading: a mismatch a policy weighs at zero is still a pattern common in automated
 * accounts.
 */
export function directionFor(featureId: FeatureId, contribution: number): ReasonDirection {
  if (contribution > 0) {
    return "automated";
  }
  if (contribution < 0) {
    return "ordinary";
  }
  const clauses: WhyClauses | undefined = WHY_CLAUSES[featureId];
  return clauses?.ordinary === undefined ? "automated" : "ordinary";
}

export function whyFor(featureId: FeatureId, direction: ReasonDirection): string {
  const clauses: WhyClauses | undefined = WHY_CLAUSES[featureId];
  if (clauses === undefined) {
    return "";
  }
  return direction === "automated" ? clauses.automated : (clauses.ordinary ?? "");
}

export function featureIdsWithWhyClauses(): FeatureId[] {
  return Object.keys(WHY_CLAUSES);
}

/** The feature's own counter-case, when it has one. */
export function featureCaveat(featureId: FeatureId): string | undefined {
  return WHY_CLAUSES[featureId]?.caveat;
}

/** Every feature counter-case, for the wording-rule test. */
export function allFeatureCaveats(): string[] {
  return [
    ...new Set(
      Object.values(WHY_CLAUSES).flatMap((clauses: WhyClauses) =>
        clauses.caveat === undefined ? [] : [clauses.caveat],
      ),
    ),
  ];
}

/** Every clause that can reach the hover card, for the wording-rule test. */
export function allWhyClauses(): string[] {
  return [
    ...[...new Set(Object.values(WHY_CLAUSES))].flatMap((clauses: WhyClauses) =>
      clauses.ordinary === undefined ? [clauses.automated] : [clauses.automated, clauses.ordinary],
    ),
    DECLARED_WHY,
  ];
}
