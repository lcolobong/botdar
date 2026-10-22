/**
 * Reddit feature extraction. Each feature id, group, input and gate comes from the Reddit table in
 * docs/scoring-spec.md. Gating is this module's job: a feature whose gate is not met is omitted, and
 * the engine never sees it.
 */
import { isRedditGeneratedName } from "../../core/handle/shape";
import type {
  AccountSignals,
  Feature,
  IndependenceGroup,
  SignalField,
  SourceTier,
} from "../../core/types";

const DAY_MILLIS = 86_400_000;
const KARMA_PER_DAY_MAX_AGE_DAYS = 180;
const POST_TO_COMMENT_MIN_LINK_KARMA = 500;
/** The username is rendered on every post, so the name feature is always Tier 0 evidence. */
const HANDLE_TIER: SourceTier = 0;

/**
 * The suggested-name pattern needs the capitals Reddit renders, which AccountRef.handle has lost;
 * Tier 0 records the rendered username as displayName. Tier 2 replaces it only when the profile
 * carries a custom title, and an account that chose a display name is not keeping a suggested one.
 */
function matchesGeneratedName(signals: AccountSignals): boolean {
  return isRedditGeneratedName(signals.displayName ?? signals.ref.handle);
}

/** The most expensive tier among the fields a feature reads; fields with no record count as DOM. */
function tierOf(signals: AccountSignals, fields: SignalField[]): SourceTier {
  let highest: SourceTier = 0;
  for (const field of fields) {
    const tier: SourceTier | undefined = signals.provenance[field];
    if (tier !== undefined && tier > highest) {
      highest = tier;
    }
  }
  return highest;
}

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
  const { linkKarma, commentKarma } = signals;

  if (
    ageDays !== undefined &&
    ageDays < KARMA_PER_DAY_MAX_AGE_DAYS &&
    linkKarma !== undefined &&
    commentKarma !== undefined
  ) {
    add("reddit.karmaPerDay", (linkKarma + commentKarma) / Math.max(ageDays, 1), "activity", [
      "createdAt",
      "linkKarma",
      "commentKarma",
    ]);
  }
  if (ageDays !== undefined) {
    add("reddit.accountAgeDays", ageDays, "age", ["createdAt"]);
  }
  if (
    linkKarma !== undefined &&
    linkKarma >= POST_TO_COMMENT_MIN_LINK_KARMA &&
    commentKarma !== undefined
  ) {
    add("reddit.postToCommentKarma", linkKarma / (commentKarma + 1), "content", [
      "linkKarma",
      "commentKarma",
    ]);
  }
  features.push({
    id: "reddit.generatedName",
    value: matchesGeneratedName(signals),
    group: "handle",
    tier: HANDLE_TIER,
  });
  if (signals.hasDefaultAvatar !== undefined) {
    add("reddit.noAvatar", signals.hasDefaultAvatar, "profile", ["hasDefaultAvatar"]);
  }
  if (signals.hasVerifiedEmail !== undefined) {
    add("reddit.noVerifiedEmail", !signals.hasVerifiedEmail, "profile", ["hasVerifiedEmail"]);
  }
  return features;
}
