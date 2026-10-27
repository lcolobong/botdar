/**
 * Hacker News feature extraction. Each feature id, group, input and gate comes from the Hacker News
 * table in docs/scoring-spec.md. Gating is this module's job: a feature whose gate is not met is
 * omitted, and the engine never sees it. Every input comes from the Firebase lookup (Tier 2): the
 * page shows a name and nothing else, and Hacker News has no avatars, no follower graph and no
 * suggested usernames to read.
 */
import { DAY_MILLIS, KARMA_RATE_MAX_AGE_DAYS, tierOf } from "../../core/scoring/featureSupport";
import type { AccountSignals, Feature, IndependenceGroup, SignalField } from "../../core/types";

/** A rate over a handful of comments is noise; a new account's first day can hold ten. */
const SUBMISSIONS_PER_DAY_MIN_COUNT = 10;

export function toFeatures(signals: AccountSignals, now: number = Date.now()): Feature[] {
  const features: Feature[] = [];
  const add = (
    id: string,
    value: number | boolean,
    group: IndependenceGroup,
    fields: SignalField[],
  ): void => {
    features.push({ id, value, group, tier: tierOf(signals, fields) });
  };
  const ageDays: number | undefined =
    signals.createdAt === undefined
      ? undefined
      : Math.max((now - signals.createdAt) / DAY_MILLIS, 0);
  const { karma, postCount: submissions, bio: about } = signals;

  if (ageDays !== undefined) {
    add("hn.accountAgeDays", ageDays, "age", ["createdAt"]);
    if (ageDays < KARMA_RATE_MAX_AGE_DAYS && karma !== undefined) {
      add("hn.karmaPerDay", Math.max(karma, 0) / Math.max(ageDays, 1), "activity", [
        "createdAt",
        "karma",
      ]);
    }
    if (submissions !== undefined && submissions >= SUBMISSIONS_PER_DAY_MIN_COUNT) {
      add("hn.submissionsPerDay", submissions / Math.max(ageDays, 1), "activity", [
        "createdAt",
        "postCount",
      ]);
    }
  }
  // Most people leave the about field empty, so only a filled one is evidence: of effort spent on
  // this one account. The bio is only known once the lookup delivered.
  if (about !== undefined) {
    add("hn.hasAbout", about.length > 0, "profile", ["bio"]);
  }
  return features;
}
