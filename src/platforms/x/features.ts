/**
 * X feature extraction. Each feature id, group, input and gate comes from the X table in
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
const FOLLOWING_RATIO_MIN_FOLLOWING = 100;
const REPLY_SHARE_MIN_SAMPLE_SIZE = 20;
const NEW_ACCOUNT_MAX_AGE_DAYS = 90;
/** Handle features come from the rendered handle, which every tier can see. */
const HANDLE_TIER: SourceTier = 0;

// TODO(handle-shape): replace with src/core/handle/shape.ts once the handle-shape branch lands.
const NAME_THEN_DIGITS_PATTERN = /^[a-z]+\d{5,}$/;
const TRAILING_DIGITS_PATTERN = /\d+$/;

function matchesNameThenDigits(handle: string): boolean {
  return NAME_THEN_DIGITS_PATTERN.test(handle);
}

function trailingDigitCount(handle: string): number {
  return TRAILING_DIGITS_PATTERN.exec(handle)?.[0].length ?? 0;
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

function regionFromNavigatorLanguage(): string | undefined {
  const language: string | undefined = globalThis.navigator?.language;
  if (language === undefined) {
    return undefined;
  }
  try {
    // Only an explicit region counts; "en" alone must not be inferred as "US".
    return new Intl.Locale(language).region;
  } catch {
    return undefined;
  }
}

function normaliseCountryName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * X's About dialog reports a country name ("United States"), not a code, and the wording follows the
 * viewer's X display language. The region code is rendered into a name in English and in the browser
 * language and compared with both, so a mismatch is only declared when neither spelling agrees.
 */
function countryMatchesRegion(country: string, region: string): boolean | undefined {
  const locales: string[] = ["en", globalThis.navigator?.language ?? "en"];
  try {
    const renderedNames: string[] = locales.flatMap((locale) => {
      const rendered: string | undefined = new Intl.DisplayNames([locale], {
        type: "region",
      }).of(region);
      return rendered === undefined ? [] : [normaliseCountryName(rendered)];
    });
    if (renderedNames.length === 0) {
      return undefined;
    }
    return renderedNames.includes(normaliseCountryName(country));
  } catch {
    return undefined;
  }
}

export function toFeatures(
  signals: AccountSignals,
  now: number = Date.now(),
  localeRegion: string | undefined = regionFromNavigatorLanguage(),
): Feature[] {
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
    value: matchesNameThenDigits(handle),
    group: "handle",
    tier: HANDLE_TIER,
  });
  features.push({
    id: "x.handleTrailingDigits",
    value: trailingDigitCount(handle),
    group: "handle",
    tier: HANDLE_TIER,
  });
  // TODO(handle-bigram): emit x.handleBigramLL from src/core/handle/bigram.ts once that branch lands.

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
  if (signals.country !== undefined && localeRegion !== undefined) {
    const matches: boolean | undefined = countryMatchesRegion(signals.country, localeRegion);
    if (matches !== undefined) {
      add("x.countryLocaleMismatch", !matches, "geo", ["country"]);
    }
  }
  return features;
}
