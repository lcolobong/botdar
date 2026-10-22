/**
 * Parsers for Bluesky AppView responses. `parseProfiles` reads `app.bsky.actor.getProfiles` (Tier 2,
 * full counts); `parseFeedAuthors` reads the author views embedded in feed and thread responses
 * (Tier 1: identity, join date, labels and verification, but no counts). Bodies are untrusted page
 * data: every read is type-guarded, strings are capped, the walk is bounded, and nothing here throws.
 */
import type { AccountRef, PartialSignals, VerifiedKind } from "../../../core/types";

type UnknownRecord = Record<string, unknown>;

export interface ParsedBlueskyProfile {
  ref: AccountRef;
  signals: PartialSignals;
}

const MAX_WALK_NODES = 200_000;
const MAX_AUTHORS_PER_RESPONSE = 500;
const MAX_BIO_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_HANDLE_LENGTH = 253;
const DID_PREFIX = "did:";
const BOT_LABEL_VALUE = "bot";
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

function readCount(parent: UnknownRecord | undefined, key: string): number | undefined {
  const value = parent?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

// MARK: - Field readers

function createdAtOf(node: UnknownRecord): number | undefined {
  const createdAt: string | undefined = readString(node, "createdAt");
  if (createdAt === undefined || !ISO_TIMESTAMP_PATTERN.test(createdAt)) {
    return undefined;
  }
  const millis: number = Date.parse(createdAt);
  return Number.isFinite(millis) && millis > 0 ? millis : undefined;
}

/** A `bot` label is a self-label only when the account itself (`src === did`) applied it. */
function declaredAutomatedOf(node: UnknownRecord, did: string): boolean | undefined {
  const labels: unknown = node.labels;
  if (!Array.isArray(labels)) {
    return undefined;
  }
  return labels.some(
    (label) =>
      isRecord(label) &&
      readString(label, "val") === BOT_LABEL_VALUE &&
      readString(label, "src") === did,
  );
}

/**
 * Bluesky verification is granted by trusted verifiers (Bluesky itself, news organisations), never
 * bought, so it says nothing about paid-badge patterns. It maps onto "blue" only because that is the
 * VerifiedKind for a per-account checkmark; a feature like x.newAndBlue must not be ported from it.
 */
function verifiedKindOf(node: UnknownRecord): VerifiedKind | undefined {
  const verification: UnknownRecord | undefined = readRecord(node, "verification");
  if (verification === undefined) {
    return undefined;
  }
  return readString(verification, "verifiedStatus") === "valid" ? "blue" : "none";
}

function toSignals(node: UnknownRecord, did: string): PartialSignals {
  const signals: PartialSignals = {};
  const createdAt: number | undefined = createdAtOf(node);
  if (createdAt !== undefined) {
    signals.createdAt = createdAt;
  }
  const followers: number | undefined = readCount(node, "followersCount");
  if (followers !== undefined) {
    signals.followers = followers;
  }
  const following: number | undefined = readCount(node, "followsCount");
  if (following !== undefined) {
    signals.following = following;
  }
  const postCount: number | undefined = readCount(node, "postsCount");
  if (postCount !== undefined) {
    signals.postCount = postCount;
  }
  const displayName: string | undefined = readString(node, "displayName");
  if (displayName !== undefined) {
    signals.displayName = displayName.slice(0, MAX_DISPLAY_NAME_LENGTH);
  }
  const bio: string | undefined = readString(node, "description");
  if (bio !== undefined) {
    signals.bio = bio.slice(0, MAX_BIO_LENGTH);
  }
  // The AppView omits `avatar` entirely when none is set, so absence is an observation, not a gap.
  const avatarUrl: string = readString(node, "avatar")?.trim() ?? "";
  signals.hasDefaultAvatar = avatarUrl.length === 0;
  const verified: VerifiedKind | undefined = verifiedKindOf(node);
  if (verified !== undefined) {
    signals.verified = verified;
  }
  const declaredAutomated: boolean | undefined = declaredAutomatedOf(node, did);
  if (declaredAutomated !== undefined) {
    signals.declaredAutomated = declaredAutomated;
  }
  return signals;
}

/** Any object carrying a DID and a handle is an actor view: profile, feed author, reposter, quoted author. */
function asProfile(node: UnknownRecord): ParsedBlueskyProfile | undefined {
  const did: string | undefined = readString(node, "did");
  const handle: string | undefined = readString(node, "handle")?.trim();
  if (
    did === undefined ||
    !did.startsWith(DID_PREFIX) ||
    handle === undefined ||
    handle.length === 0 ||
    handle.length > MAX_HANDLE_LENGTH
  ) {
    return undefined;
  }
  return {
    ref: { platform: "bluesky", handle: handle.toLowerCase(), id: did },
    signals: toSignals(node, did),
  };
}

// MARK: - Entry points

/** `app.bsky.actor.getProfiles` (`{ profiles: [...] }`) or a single `getProfile` body. */
export function parseProfiles(body: unknown): ParsedBlueskyProfile[] {
  if (!isRecord(body)) {
    return [];
  }
  const candidates: unknown[] = Array.isArray(body.profiles) ? body.profiles : [body];
  const profiles: ParsedBlueskyProfile[] = [];
  const seenDids = new Set<string>();
  for (const candidate of candidates.slice(0, MAX_AUTHORS_PER_RESPONSE)) {
    const profile: ParsedBlueskyProfile | undefined = isRecord(candidate)
      ? asProfile(candidate)
      : undefined;
    if (profile?.ref.id !== undefined && !seenDids.has(profile.ref.id)) {
      seenDids.add(profile.ref.id);
      profiles.push(profile);
    }
  }
  return profiles;
}

/**
 * Every actor view in a `getTimeline`, `getFeed`, `getAuthorFeed` or `getPostThread` body, in document
 * order and deduplicated by DID: `feed[].post.author`, repost `reason.by`, quoted-record authors,
 * `thread.post.author` and the authors of nested `replies[]` and `parent` chains. The walk is
 * iterative and bounded so a hostile or enormous body cannot stall the content script.
 */
export function parseFeedAuthors(body: unknown): ParsedBlueskyProfile[] {
  const profiles: ParsedBlueskyProfile[] = [];
  const seenDids = new Set<string>();
  const visited = new WeakSet<object>();
  const pending: unknown[] = [body];
  let visitedCount = 0;
  while (
    pending.length > 0 &&
    visitedCount < MAX_WALK_NODES &&
    profiles.length < MAX_AUTHORS_PER_RESPONSE
  ) {
    const node: unknown = pending.pop();
    if (typeof node !== "object" || node === null || visited.has(node)) {
      continue;
    }
    visited.add(node);
    visitedCount += 1;
    const children: unknown[] = Array.isArray(node) ? node : [];
    if (isRecord(node)) {
      const profile: ParsedBlueskyProfile | undefined = asProfile(node);
      if (profile !== undefined) {
        if (profile.ref.id !== undefined && !seenDids.has(profile.ref.id)) {
          seenDids.add(profile.ref.id);
          profiles.push(profile);
        }
        continue;
      }
      children.push(...Object.values(node));
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return profiles;
}
