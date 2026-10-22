/**
 * Reddit feature extraction. Each feature id, group, input and gate comes from the Reddit table in
 * docs/scoring-spec.md. Gating is this module's job: a feature whose gate is not met is omitted, and
 * the engine never sees it.
 */
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
/** The handle comes from the rendered author attribute, which every tier can see. */
const HANDLE_TIER: SourceTier = 0;

// TODO(handle-shape): replace with src/core/handle/shape.ts once the handle-shape branch lands.
/**
 * Reddit's suggested usernames are Adjective_Noun_1234 or Adjective-Noun-1234, both words
 * capitalised. AccountRef lowercases handles, so a lowercased handle is matched case-insensitively
 * and only a handle that still carries case has to show the capitals.
 */
const GENERATED_NAME_PATTERN = /^[A-Z][a-z]+[-_][A-Z][a-z]+[-_]?\d{1,4}$/;
const GENERATED_NAME_PATTERN_ANY_CASE = /^[a-z]+[-_][a-z]+[-_]?\d{1,4}$/i;

function matchesGeneratedName(handle: string): boolean {
  const isLowercased: boolean = handle === handle.toLowerCase();
  return (isLowercased ? GENERATED_NAME_PATTERN_ANY_CASE : GENERATED_NAME_PATTERN).test(handle);
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
    value: matchesGeneratedName(signals.ref.handle),
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
