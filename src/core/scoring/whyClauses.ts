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
const SUGGESTED_HANDLE: WhyClauses = { automated: "unchanged suggested handle" };
const PROFILE_EFFORT: WhyClauses = {
  automated: "left as created",
  ordinary: "effort spent on this one account",
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
  "reddit.karmaPerDay": {
    automated: "karma-farming pattern",
    ordinary: "a pace ordinary use earns",
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
};

export const DECLARED_WHY = "self-declared";

/**
 * Positive evidence points towards automation and negative evidence away from it. Evidence that
 * weighs nothing points away too, as the Likely human rule counts it, unless the feature has no
 * ordinary reading: a mismatch held at zero weight is still a pattern common in automated accounts.
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

/** Every clause that can reach the hover card, for the wording-rule test. */
export function allWhyClauses(): string[] {
  return [
    ...[...new Set(Object.values(WHY_CLAUSES))].flatMap((clauses: WhyClauses) =>
      clauses.ordinary === undefined ? [clauses.automated] : [clauses.automated, clauses.ordinary],
    ),
    DECLARED_WHY,
  ];
}
