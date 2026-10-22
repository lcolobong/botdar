/**
 * Shape features of a handle: digit runs and the generated-name patterns platforms suggest to new
 * accounts. See docs/scoring-spec.md ("Default feature tables", handle group).
 *
 * Every function takes a lowercased handle without its "@" or "u/" prefix (AccountRef.handle), except
 * isRedditGeneratedName, which needs the original casing.
 */

const DIGIT_PATTERN = /\d/g;
const TRAILING_DIGITS_PATTERN = /\d+$/;
const LETTERS_THEN_DIGITS_PATTERN = /^[a-z]+(\d+)$/;

/** Reddit's suggested names: Adjective-Noun-1234 or Adjective_Noun_1234, each word capitalized. */
const REDDIT_GENERATED_NAME_PATTERN = /^[A-Z][a-z]+[-_][A-Z][a-z]+[-_]\d{2,4}$/;

const BSKY_SOCIAL_SUFFIX = ".bsky.social";
const BSKY_SOCIAL_LOCAL_PART_MINIMUM_DIGITS = 3;

export function digitCount(handle: string): number {
  return handle.match(DIGIT_PATTERN)?.length ?? 0;
}

export function trailingDigitCount(handle: string): number {
  return TRAILING_DIGITS_PATTERN.exec(handle)?.[0].length ?? 0;
}

/**
 * Letters followed by a run of at least `minimumDigits` digits: the shape X suggests when the chosen
 * name is taken (`jordan82736451`). The spec's X feature uses 5 digits, Bluesky's uses 4.
 */
export function looksLikeNamePlusDigits(handle: string, minimumDigits = 4): boolean {
  const digitRun: string | undefined = LETTERS_THEN_DIGITS_PATTERN.exec(handle)?.[1];
  return digitRun !== undefined && digitRun.length >= minimumDigits;
}

export function isRedditGeneratedName(rawHandle: string): boolean {
  return REDDIT_GENERATED_NAME_PATTERN.test(rawHandle);
}

/** A free `.bsky.social` handle whose local part carries three or more digits. Custom domains never match. */
export function isBskySocialHandleWithDigits(handle: string): boolean {
  if (!handle.endsWith(BSKY_SOCIAL_SUFFIX)) {
    return false;
  }
  const localPart: string = handle.slice(0, -BSKY_SOCIAL_SUFFIX.length);
  return localPart.length > 0 && digitCount(localPart) >= BSKY_SOCIAL_LOCAL_PART_MINIMUM_DIGITS;
}
