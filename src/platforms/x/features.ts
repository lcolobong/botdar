/**
 * X feature extraction. Each feature id, group, input and gate comes from the X table in
 * docs/scoring-spec.md. Gating is this module's job: a feature whose gate is not met is omitted, and
 * the engine never sees it.
 */
import { handleBigramLogLikelihood } from "../../core/handle/bigram";
import { looksLikeNamePlusDigits, trailingDigitCount } from "../../core/handle/shape";
import type { Cadence } from "../../core/scoring/cadence";
import { cadenceOf } from "../../core/scoring/cadence";
import type { CountryLanguageComparison } from "../../core/text/accountLanguage";
import { countryLanguageMismatch } from "../../core/text/accountLanguage";
import type {
  AccountSignals,
  Feature,
  IndependenceGroup,
  SignalField,
  SourceTier,
} from "../../core/types";

const DAY_MILLIS = 86_400_000;
const FOLLOWING_RATIO_MIN_FOLLOWING = 100;
const REPLY_SHARE_MIN_SAMPLE_SIZE = 20;
const NEW_ACCOUNT_MAX_AGE_DAYS = 90;
/** Handle features come from the rendered handle, which every tier can see. */
const HANDLE_TIER: SourceTier = 0;
/** X suggests name-plus-digits handles with five digits; shorter runs are common in chosen names. */
const NAME_PLUS_DIGITS_MIN_DIGITS = 5;
/** The bigram likelihood is meaningless on a handle that is mostly digits or punctuation. */
const BIGRAM_MIN_LETTERS = 4;
const LETTER_PATTERN = /[a-z]/g;

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

/**
 * X prints the About dialog's country in the viewer's X display language, which normally follows the
 * browser's; that language only helps read the name.
 */
function countryNameLocales(): string[] {
  const language: string | undefined = globalThis.navigator?.language;
  return language === undefined ? [] : [language];
}

export function toFeatures(
  signals: AccountSignals,
  now: number = Date.now(),
  countryLocales: readonly string[] = countryNameLocales(),
): Feature[] {
  const features: Feature[] = [];
  const add = (
    id: string,
    value: number | boolean,
    group: IndependenceGroup,
    fields: SignalField[],
    detail?: string,
  ): void => {
    features.push({
      id,
      value,
      group,
      tier: tierOf(signals, fields),
      ...(detail === undefined ? {} : { detail }),
    });
  };
  const ageDays: number | undefined =
    signals.createdAt === undefined
      ? undefined
      : Math.max((now - signals.createdAt) / DAY_MILLIS, 0);

  if (ageDays !== undefined && signals.postCount !== undefined) {
    add("x.postsPerDay", signals.postCount / Math.max(ageDays, 1), "activity", [
      "createdAt",
      "postCount",
    ]);
  }
  if (ageDays !== undefined) {
    add("x.accountAgeDays", ageDays, "age", ["createdAt"]);
  }
  if (
    signals.following !== undefined &&
    signals.following >= FOLLOWING_RATIO_MIN_FOLLOWING &&
    signals.followers !== undefined
  ) {
    add("x.followingRatio", signals.following / (signals.followers + 1), "graph", [
      "followers",
      "following",
    ]);
  }

  const handle: string = signals.ref.handle;
  features.push({
    id: "x.handleNameDigits",
    value: looksLikeNamePlusDigits(handle, NAME_PLUS_DIGITS_MIN_DIGITS),
    group: "handle",
    tier: HANDLE_TIER,
  });
  features.push({
    id: "x.handleTrailingDigits",
    value: trailingDigitCount(handle),
    group: "handle",
    tier: HANDLE_TIER,
  });
  if ((handle.match(LETTER_PATTERN)?.length ?? 0) >= BIGRAM_MIN_LETTERS) {
    features.push({
      id: "x.handleBigramLL",
      value: handleBigramLogLikelihood(handle),
      group: "handle",
      tier: HANDLE_TIER,
    });
  }

  if (signals.hasDefaultAvatar !== undefined && signals.bio !== undefined) {
    const emptyProfileCount: number =
      (signals.hasDefaultAvatar ? 1 : 0) + (signals.bio.trim().length === 0 ? 1 : 0);
    add("x.defaultAvatarEmptyBio", emptyProfileCount, "profile", ["hasDefaultAvatar", "bio"]);
  }
  if (signals.verified !== undefined && ageDays !== undefined) {
    add(
      "x.newAndBlue",
      signals.verified === "blue" && ageDays < NEW_ACCOUNT_MAX_AGE_DAYS,
      "verification",
      ["verified", "createdAt"],
    );
  }
  if (
    signals.replyShare !== undefined &&
    signals.replyShare.sampleSize >= REPLY_SHARE_MIN_SAMPLE_SIZE
  ) {
    add("x.replyShare", signals.replyShare.ratio, "content", ["replyShare"]);
  }
  if (signals.usernameChanges !== undefined) {
    add("x.usernameChanges", signals.usernameChanges, "profile", ["usernameChanges"]);
  }
  if (signals.country !== undefined) {
    const comparison: CountryLanguageComparison | undefined = countryLanguageMismatch(
      signals.country,
      signals,
      countryLocales,
    );
    if (comparison !== undefined) {
      add(
        "x.countryLocaleMismatch",
        comparison.mismatch,
        "geo",
        ["country", "bio", "postText"],
        comparison.language,
      );
    }
  }
  const cadence: Cadence = cadenceOf(signals);
  if (cadence.gapCoefficientOfVariation !== undefined) {
    add("x.gapRegularity", cadence.gapCoefficientOfVariation, "timing", ["postTimestamps"]);
  }
  if (cadence.longestEmptyHourRun !== undefined) {
    add("x.noSleepWindow", cadence.longestEmptyHourRun, "timing", ["postTimestamps"]);
  }
  return features;
}
