/**
 * Tier 1 parser for X GraphQL responses (HomeTimeline, TweetDetail, UserByScreenName, SearchTimeline,
 * UserTweets, AboutAccountQuery). Bodies are untrusted page data: every read is type-guarded, strings
 * are capped, the walk is bounded, and nothing here throws.
 *
 * X ships two user shapes side by side. The 2026 shape keeps identity under `core.*`, counts under
 * `relationship_counts` / `tweet_counts`, the bio under `profile_bio`, the avatar under `avatar`. The
 * older shape keeps all of that under `legacy.*`. The newer field wins whenever both are present.
 */
import type { AccountRef, PartialSignals, VerifiedKind } from "../../../core/types";

type UnknownRecord = Record<string, unknown>;

export interface ParsedXUser {
  ref: AccountRef;
  /** The raw user object as found in the response; read it through `toSignals`. */
  node: UnknownRecord;
}

export interface ParsedAboutAccount {
  handle: string;
  country?: string;
  usernameChanges?: number;
  appStore?: string;
  declaredAutomated?: boolean;
}

const MAX_WALK_NODES = 200_000;
const MAX_USERS_PER_RESPONSE = 500;
const MAX_BIO_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_COUNTRY_LENGTH = 64;
const MAX_APP_STORE_LENGTH = 32;
const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const DEFAULT_AVATAR_PATH_SEGMENT = "default_profile_images";
const AUTOMATED_LABEL_TYPE = "AutomatedLabel";
const MONTH_ABBREVIATIONS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
/** X's own timestamp format, e.g. "Wed Oct 10 20:19:24 +0000 2018". */
const X_TIMESTAMP_PATTERN =
  /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

// MARK: - Type guards

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(parent: UnknownRecord | undefined, key: string): UnknownRecord | undefined {
  const value = parent?.[key];
  return isRecord(value) ? value : undefined;
}

function readString(parent: UnknownRecord | undefined, key: string): string | undefined {
  const value = parent?.[key];
  return typeof value === "string" ? value : undefined;
}

function readBoolean(parent: UnknownRecord | undefined, key: string): boolean | undefined {
  const value = parent?.[key];
  return typeof value === "boolean" ? value : undefined;
}

/** Non-negative safe integers only; X occasionally serialises counts as strings, which stay unobserved. */
function readCount(parent: UnknownRecord | undefined, key: string): number | undefined {
  const value = parent?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

// MARK: - Field readers

export function parseXTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = X_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    const isoMillis: number = ISO_TIMESTAMP_PATTERN.test(value) ? Date.parse(value) : Number.NaN;
    return Number.isFinite(isoMillis) && isoMillis > 0 ? isoMillis : undefined;
  }
  const [, month, day, hours, minutes, seconds, offsetSign, offsetHours, offsetMinutes, year] =
    match;
  const monthIndex: number = MONTH_ABBREVIATIONS.indexOf((month ?? "").toLowerCase());
  if (monthIndex < 0) {
    return undefined;
  }
  const utcMillis: number = Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
  const offsetMillis: number =
    (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000 * (offsetSign === "-" ? -1 : 1);
  const millis: number = utcMillis - offsetMillis;
  return Number.isFinite(millis) && millis > 0 ? millis : undefined;
}

function screenNameOf(node: UnknownRecord): string | undefined {
  const screenName: string | undefined =
    readString(readRecord(node, "core"), "screen_name") ??
    readString(readRecord(node, "legacy"), "screen_name");
  return screenName !== undefined && SCREEN_NAME_PATTERN.test(screenName) ? screenName : undefined;
}

function verifiedKindOf(node: UnknownRecord): VerifiedKind | undefined {
  const verifiedType: string | undefined = (
    readString(readRecord(node, "verification"), "verified_type") ??
    readString(readRecord(node, "legacy"), "verified_type")
  )?.toLowerCase();
  if (verifiedType === "business") {
    return "org";
  }
  if (verifiedType === "government") {
    return "gov";
  }
  const isBlueVerified: boolean | undefined = readBoolean(node, "is_blue_verified");
  if (isBlueVerified === true) {
    return "blue";
  }
  return isBlueVerified === false || verifiedType !== undefined ? "none" : undefined;
}

function hasDefaultAvatarOf(node: UnknownRecord): boolean | undefined {
  const legacy: UnknownRecord | undefined = readRecord(node, "legacy");
  const avatarUrl: string | undefined =
    readString(readRecord(node, "avatar"), "image_url") ??
    readString(legacy, "profile_image_url_https");
  const defaultImageFlag: boolean | undefined = readBoolean(legacy, "default_profile_image");
  if (defaultImageFlag === true || avatarUrl?.includes(DEFAULT_AVATAR_PATH_SEGMENT)) {
    return true;
  }
  return defaultImageFlag === false || avatarUrl !== undefined ? false : undefined;
}

/**
 * X's "Automated" label has not yet been confirmed in a recorded response (day-one validation 8 in
 * docs/architecture.md). Two candidate locations are read: a `legacy.automated` boolean and the
 * affiliates label with `userLabelType === "AutomatedLabel"`. An affiliates label that is present but
 * empty, which is what most users carry, reads as "observed, not automated"; no label object at all
 * stays unobserved so the engine cannot mistake a schema change for a human account.
 */
function declaredAutomatedOf(node: UnknownRecord): boolean | undefined {
  const legacyFlag: boolean | undefined = readBoolean(readRecord(node, "legacy"), "automated");
  if (legacyFlag !== undefined) {
    return legacyFlag;
  }
  const affiliatesLabel: UnknownRecord | undefined = readRecord(
    node,
    "affiliates_highlighted_label",
  );
  if (affiliatesLabel === undefined) {
    return undefined;
  }
  return readString(readRecord(affiliatesLabel, "label"), "userLabelType") === AUTOMATED_LABEL_TYPE;
}

// MARK: - Users

function asUser(node: UnknownRecord): ParsedXUser | undefined {
  const restId: string | undefined = readString(node, "rest_id");
  const screenName: string | undefined = screenNameOf(node);
  if (restId === undefined || screenName === undefined) {
    return undefined;
  }
  return { ref: { platform: "x", handle: screenName.toLowerCase(), id: restId }, node };
}

/**
 * Finds every user object anywhere in a GraphQL body, in document order, deduplicated by `rest_id`.
 * The walk is iterative and bounded so a hostile or enormous body cannot stall the content script.
 */
export function collectUsers(body: unknown): ParsedXUser[] {
  const users: ParsedXUser[] = [];
  const seenIds = new Set<string>();
  const visited = new WeakSet<object>();
  const pending: unknown[] = [body];
  let visitedCount = 0;
  while (
    pending.length > 0 &&
    visitedCount < MAX_WALK_NODES &&
    users.length < MAX_USERS_PER_RESPONSE
  ) {
    const node: unknown = pending.pop();
    if (typeof node !== "object" || node === null || visited.has(node)) {
      continue;
    }
    visited.add(node);
    visitedCount += 1;
    const children: unknown[] = Array.isArray(node) ? node : [];
    if (isRecord(node)) {
      const user: ParsedXUser | undefined = asUser(node);
      if (user !== undefined) {
        if (user.ref.id !== undefined && !seenIds.has(user.ref.id)) {
          seenIds.add(user.ref.id);
          users.push(user);
        }
        continue;
      }
      children.push(...Object.values(node));
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return users;
}

export function toSignals(user: ParsedXUser): PartialSignals {
  const { node } = user;
  const core: UnknownRecord | undefined = readRecord(node, "core");
  const legacy: UnknownRecord | undefined = readRecord(node, "legacy");
  const relationshipCounts: UnknownRecord | undefined = readRecord(node, "relationship_counts");
  const tweetCounts: UnknownRecord | undefined = readRecord(node, "tweet_counts");
  const signals: PartialSignals = {};

  const createdAt: number | undefined = parseXTimestamp(
    readString(core, "created_at") ?? readString(legacy, "created_at"),
  );
  if (createdAt !== undefined) {
    signals.createdAt = createdAt;
  }
  const followers: number | undefined =
    readCount(relationshipCounts, "followers") ?? readCount(legacy, "followers_count");
  if (followers !== undefined) {
    signals.followers = followers;
  }
  const following: number | undefined =
    readCount(relationshipCounts, "following") ?? readCount(legacy, "friends_count");
  if (following !== undefined) {
    signals.following = following;
  }
  const postCount: number | undefined =
    readCount(tweetCounts, "tweets") ?? readCount(legacy, "statuses_count");
  if (postCount !== undefined) {
    signals.postCount = postCount;
  }
  const displayName: string | undefined = readString(core, "name") ?? readString(legacy, "name");
  if (displayName !== undefined) {
    signals.displayName = displayName.slice(0, MAX_DISPLAY_NAME_LENGTH);
  }
  const bio: string | undefined =
    readString(readRecord(node, "profile_bio"), "description") ?? readString(legacy, "description");
  if (bio !== undefined) {
    signals.bio = bio.slice(0, MAX_BIO_LENGTH);
  }
  const hasDefaultAvatar: boolean | undefined = hasDefaultAvatarOf(node);
  if (hasDefaultAvatar !== undefined) {
    signals.hasDefaultAvatar = hasDefaultAvatar;
  }
  const verified: VerifiedKind | undefined = verifiedKindOf(node);
  if (verified !== undefined) {
    signals.verified = verified;
  }
  const declaredAutomated: boolean | undefined = declaredAutomatedOf(node);
  if (declaredAutomated !== undefined) {
    signals.declaredAutomated = declaredAutomated;
  }
  return signals;
}

// MARK: - AboutAccountQuery

/** Tier 2 projection of `AboutAccountQuery`; null when the body is not that response. */
export function parseAboutAccount(body: unknown): ParsedAboutAccount | null {
  if (!isRecord(body)) {
    return null;
  }
  const result: UnknownRecord | undefined = readRecord(
    readRecord(readRecord(body, "data"), "user_result_by_screen_name"),
    "result",
  );
  const screenName: string | undefined = result === undefined ? undefined : screenNameOf(result);
  if (result === undefined || screenName === undefined) {
    return null;
  }
  const aboutProfile: UnknownRecord | undefined = readRecord(result, "about_profile");
  const parsed: ParsedAboutAccount = { handle: screenName.toLowerCase() };

  const country: string = readString(aboutProfile, "account_based_in")?.trim() ?? "";
  if (country.length > 0) {
    parsed.country = country.slice(0, MAX_COUNTRY_LENGTH);
  }
  // The count has been seen both as a number and as a decimal string.
  const rawChanges: unknown = readRecord(aboutProfile, "username_changes")?.count;
  const usernameChanges: number =
    typeof rawChanges === "number" ? rawChanges : Number.parseInt(String(rawChanges ?? ""), 10);
  if (Number.isSafeInteger(usernameChanges) && usernameChanges >= 0) {
    parsed.usernameChanges = usernameChanges;
  }
  const appStore: string = readString(aboutProfile, "source")?.trim() ?? "";
  if (appStore.length > 0) {
    parsed.appStore = appStore.slice(0, MAX_APP_STORE_LENGTH);
  }
  const declaredAutomated: boolean | undefined = declaredAutomatedOf(result);
  if (declaredAutomated !== undefined) {
    parsed.declaredAutomated = declaredAutomated;
  }
  return parsed;
}

/** The AboutAccountQuery projection as signals; the handle stays on the caller's AccountRef. */
export function toAboutSignals(parsed: ParsedAboutAccount): PartialSignals {
  const signals: PartialSignals = {};
  if (parsed.country !== undefined) {
    signals.country = parsed.country;
  }
  if (parsed.usernameChanges !== undefined) {
    signals.usernameChanges = parsed.usernameChanges;
  }
  if (parsed.appStore !== undefined) {
    signals.appStore = parsed.appStore;
  }
  if (parsed.declaredAutomated !== undefined) {
    signals.declaredAutomated = parsed.declaredAutomated;
  }
  return signals;
}
