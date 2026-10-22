/**
 * Bluesky feature extraction. Each feature id, group, input and gate comes from the Bluesky table in
 * docs/scoring-spec.md. Gating is this module's job: a feature whose gate is not met is omitted, and
 * the engine never sees it. The declared-bot override is not a feature; the engine reads
 * `signals.declaredAutomated` directly.
 */
import type {
  AccountSignals,
  Feature,
  IndependenceGroup,
  SignalField,
  SourceTier,
} from "../../core/types";

const DAY_MILLIS = 86_400_000;
const FOLLOWS_RATIO_MIN_FOLLOWING = 100;
const BSKY_SOCIAL_SUFFIX = ".bsky.social";
/** The handle comes from the rendered profile link, which every tier can see. */
const HANDLE_TIER: SourceTier = 0;

// TODO(handle-shape): replace with src/core/handle/shape.ts once the handle-shape branch lands.
/** Only the free `*.bsky.social` namespace gets suggested handles; a custom domain never fires. */
const LOCAL_PART_NAME_THEN_DIGITS_PATTERN = /^[a-z]+\d{4,}$/;

function matchesDigitsOnBskySocial(handle: string): boolean {
  if (!handle.endsWith(BSKY_SOCIAL_SUFFIX)) {
    return false;
  }
  const localPart: string = handle.slice(0, -BSKY_SOCIAL_SUFFIX.length);
  return LOCAL_PART_NAME_THEN_DIGITS_PATTERN.test(localPart);
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

  if (ageDays !== undefined && signals.postCount !== undefined) {
    add("bsky.postsPerDay", signals.postCount / Math.max(ageDays, 1), "activity", [
      "createdAt",
      "postCount",
    ]);
  }
  if (ageDays !== undefined) {
    add("bsky.accountAgeDays", ageDays, "age", ["createdAt"]);
  }
  if (
    signals.following !== undefined &&
    signals.following >= FOLLOWS_RATIO_MIN_FOLLOWING &&
    signals.followers !== undefined
  ) {
    add("bsky.followsRatio", signals.following / (signals.followers + 1), "graph", [
      "followers",
      "following",
    ]);
  }
  features.push({
    id: "bsky.handleDigitsOnBskySocial",
    value: matchesDigitsOnBskySocial(signals.ref.handle),
    group: "handle",
    tier: HANDLE_TIER,
  });
  if (signals.hasDefaultAvatar !== undefined && signals.bio !== undefined) {
    const emptyProfileCount: number =
      (signals.hasDefaultAvatar ? 1 : 0) + (signals.bio.trim().length === 0 ? 1 : 0);
    add("bsky.noAvatarEmptyBio", emptyProfileCount, "profile", ["hasDefaultAvatar", "bio"]);
  }
  return features;
}
