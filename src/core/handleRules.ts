/**
 * The handle rules the fixture anonymizer and the platform handle readers must answer alike: a
 * reader that recognises a shape and an anonymizer that keeps it have to agree on what the shape
 * is. Pure and import-free, so the snapshot scripts load it under Node's type stripping and a
 * content script bundles it without pulling in the fixture word lists.
 */

/**
 * The shortest captured name the anonymizer treats as a handle, counted in characters. A shorter
 * capture is more likely a stray match on ordinary markup than an account.
 */
const MIN_HANDLE_LENGTH = 3;

/**
 * Whether a captured name is long enough to be a handle. Counted in code points, not UTF-16 units,
 * so a handle written outside the Basic Multilingual Plane is not measured at twice its length.
 */
export function isHandleLongEnough(handle: string): boolean {
  return [...handle].length >= MIN_HANDLE_LENGTH;
}

/** What precedes the random string of a handle YouTube assigned before name-and-code ones. */
export const USER_PREFIX = "user-";
const USER_PREFIXED = /^user-[a-z0-9]{8,}$/;

/** Whether YouTube assigned the handle: "user-" and a random string of eight or more characters. */
export function isUserPrefixedHandle(handle: string): boolean {
  return USER_PREFIXED.test(handle.toLowerCase());
}

/**
 * A channel that never chose a handle gets its name, a hyphen and a short code of letters and
 * digits, at least one of each ("@LarryH-h6q", "@MK-to4et", in any script). A tail of digits alone
 * ("@euro-2024", "@club-007") is a chosen handle, often a year. The 2022 batch that gave every
 * existing channel a handle used its name and four digits; those are not matched, because they
 * mark a channel older than handles rather than one left as created.
 */
export const ASSIGNED_CODE = /-(?=[\p{Ll}\p{N}]*\p{N})(?=[\p{Ll}\p{N}]*\p{Ll})[\p{Ll}\p{N}]{3,5}$/u;

/** Whether the handle ends in a code YouTube assigned; case does not matter. */
export function isAssignedCodeHandle(handle: string): boolean {
  return ASSIGNED_CODE.test(handle.toLowerCase());
}
