/**
 * Tier 2 parser for Reddit `/user/<name>/about.json?raw_json=1`. The body is untrusted page data:
 * every read is type-guarded, strings are capped, and nothing here throws. A logged-out session gets
 * an HTML login page instead of JSON, and a suspended user gets a stub with `is_suspended`; both are
 * distinguished from a usable profile so the source can cache the outcome rather than retry.
 */
import { bioDeclaresAutomation } from "../../../core/handle/selfDescription";
import type { PartialSignals } from "../../../core/types";
import { isDefaultAvatarUrl, isPlausibleUsername } from "../conventions";

type UnknownRecord = Record<string, unknown>;

export type AboutParseResult =
  | { status: "ok"; handle: string; signals: PartialSignals }
  | { status: "suspended"; handle: string }
  | { status: "unavailable" };

const ACCOUNT_KIND = "t2";
const MAX_BIO_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 100;

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

/** Karma can be negative on Reddit, so only finiteness and integrality are required. */
function readInteger(parent: UnknownRecord | undefined, key: string): number | undefined {
  const value = parent?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

// MARK: - Field readers

function createdAtOf(data: UnknownRecord): number | undefined {
  const createdSeconds: unknown = data.created_utc ?? data.created;
  if (
    typeof createdSeconds !== "number" ||
    !Number.isFinite(createdSeconds) ||
    createdSeconds <= 0
  ) {
    return undefined;
  }
  return Math.round(createdSeconds * 1000);
}

function hasDefaultAvatarOf(data: UnknownRecord): boolean | undefined {
  const snoovatarUrl: string = readString(data, "snoovatar_img")?.trim() ?? "";
  if (snoovatarUrl.length > 0) {
    return false;
  }
  const iconUrl: string | undefined = readString(data, "icon_img")?.trim();
  if (iconUrl === undefined) {
    return undefined;
  }
  return iconUrl.length === 0 || isDefaultAvatarUrl(iconUrl);
}

function toSignals(data: UnknownRecord): PartialSignals {
  const signals: PartialSignals = {};
  const createdAt: number | undefined = createdAtOf(data);
  if (createdAt !== undefined) {
    signals.createdAt = createdAt;
  }
  const linkKarma: number | undefined = readInteger(data, "link_karma");
  if (linkKarma !== undefined) {
    signals.linkKarma = linkKarma;
  }
  const commentKarma: number | undefined = readInteger(data, "comment_karma");
  if (commentKarma !== undefined) {
    signals.commentKarma = commentKarma;
  }
  // The profile "subreddit" carries the display name and bio; an empty title means none was set.
  const profile: UnknownRecord | undefined = readRecord(data, "subreddit");
  const displayName: string = readString(profile, "title")?.trim() ?? "";
  if (displayName.length > 0) {
    signals.displayName = displayName.slice(0, MAX_DISPLAY_NAME_LENGTH);
  }
  const bio: string | undefined = readString(profile, "public_description");
  if (bio !== undefined) {
    signals.bio = bio.slice(0, MAX_BIO_LENGTH);
    if (bioDeclaresAutomation(bio)) {
      signals.declaredAutomated = true;
      signals.declaredBy = "bio";
    }
  }
  const hasDefaultAvatar: boolean | undefined = hasDefaultAvatarOf(data);
  if (hasDefaultAvatar !== undefined) {
    signals.hasDefaultAvatar = hasDefaultAvatar;
  }
  // Only the viewer's own about.json is documented to carry has_verified_email; whether it appears
  // for other users is a day-one check, so the field stays unobserved unless it is actually present.
  const hasVerifiedEmail: boolean | undefined = readBoolean(data, "has_verified_email");
  if (hasVerifiedEmail !== undefined) {
    signals.hasVerifiedEmail = hasVerifiedEmail;
  }
  return signals;
}

// MARK: - Entry points

export function parseAboutResponse(body: unknown): AboutParseResult {
  if (!isRecord(body) || body.kind !== ACCOUNT_KIND) {
    return { status: "unavailable" };
  }
  const data: UnknownRecord | undefined = readRecord(body, "data");
  const username: string | undefined = readString(data, "name");
  if (data === undefined || username === undefined || !isPlausibleUsername(username)) {
    return { status: "unavailable" };
  }
  const handle: string = username.toLowerCase();
  if (readBoolean(data, "is_suspended") === true) {
    return { status: "suspended", handle };
  }
  return { status: "ok", handle, signals: toSignals(data) };
}

/** Signals for a live account; null for HTML, a suspended stub or anything else. */
export function parseAbout(body: unknown): PartialSignals | null {
  const result: AboutParseResult = parseAboutResponse(body);
  return result.status === "ok" ? result.signals : null;
}
