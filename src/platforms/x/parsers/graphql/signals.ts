import type { UnknownRecord } from "@/src/core/json/untrusted";
import { readCount, readRecord, readString } from "@/src/core/json/untrusted";
import type { PartialSignals, VerifiedKind } from "@/src/core/types";
import { declaredAutomatedOf } from "./automatedLabel";
import type { ParsedXUser } from "./types";
import { hasDefaultAvatarOf, parseXTimestamp, verifiedKindOf } from "./userFields";

const MAX_BIO_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 100;

// MARK: - Signals

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
