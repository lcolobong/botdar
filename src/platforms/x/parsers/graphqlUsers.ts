/**
 * Tier 1 parser for X GraphQL responses (HomeTimeline, TweetDetail, UserByScreenName, SearchTimeline,
 * UserTweets, AboutAccountQuery). Bodies are untrusted page data: every read is type-guarded, strings
 * are capped, the walk is bounded, and nothing here throws.
 *
 * X ships two user shapes side by side. The 2026 shape keeps identity under `core.*`, counts under
 * `relationship_counts` / `tweet_counts`, the bio under `profile_bio`, the avatar under `avatar`. The
 * older shape keeps all of that under `legacy.*`. The newer field wins whenever both are present.
 * Posts keep their text under `legacy.full_text` and their author under `core.user_results.result`.
 */
import type { UnknownRecord } from "../../../core/json/untrusted";
import { isRecord, readCount, readRecord, readString } from "../../../core/json/untrusted";
import type { PartialSignals, VerifiedKind } from "../../../core/types";
import { declaredAutomatedOf } from "./graphql/automatedLabel";
import type { ParsedAboutAccount, ParsedXPost, ParsedXUser } from "./graphql/types";
import {
  hasDefaultAvatarOf,
  parseXTimestamp,
  screenNameOf,
  verifiedKindOf,
} from "./graphql/userFields";

export { collectUsers, parseGraphqlBody, postTextByHandle } from "./graphql/walk";
export type { ParsedAboutAccount, ParsedXBody, ParsedXPost, ParsedXUser } from "./graphql/types";
export { parseXTimestamp } from "./graphql/userFields";

const MAX_BIO_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_COUNTRY_LENGTH = 64;
const MAX_APP_STORE_LENGTH = 32;

export interface TimelineOwnerPosts {
  handle: string;
  /** Epoch milliseconds, as the body carried them; the pipeline normalises. */
  timestamps: number[];
}

const USER_ID_PATTERN = /^\d{1,20}$/;

/**
 * The profile's user id from a UserTweets request query, `variables={"userId":"…",…}`.
 * GUESS: the web client sends UserTweets as a GET with its variables JSON in the query string;
 * no recorded request confirms it. A POST, or a query without a readable id, gives undefined and
 * the owner falls back to the post count below.
 */
export function profileTimelineUserIdOf(query: string | undefined): string | undefined {
  if (query === undefined) {
    return undefined;
  }
  try {
    const variables: unknown = JSON.parse(new URLSearchParams(query).get("variables") ?? "");
    const userId: string | undefined = isRecord(variables)
      ? readString(variables, "userId")
      : undefined;
    return userId !== undefined && USER_ID_PATTERN.test(userId) ? userId : undefined;
  } catch {
    return undefined;
  }
}

export interface OwnerPosts {
  handle: string;
  posts: ParsedXPost[];
}

/**
 * The posts of a timeline's owner. Such a body also carries other authors' posts (quoted and
 * reposted posts, the other side of a reply), each a scattered sample of that author's timeline. The
 * owner is the user the request named (`ownerId`); only when the request did not say does the author
 * with the most posts count, and then a tie names no owner.
 */
function ownerPostsOf(posts: ParsedXPost[], ownerId?: string): OwnerPosts | undefined {
  const postsByAuthor = new Map<string, OwnerPosts>();
  for (const post of posts) {
    const authorKey: string = post.author.id ?? post.author.handle;
    if (ownerId !== undefined && authorKey !== ownerId) {
      continue;
    }
    const entry: OwnerPosts = postsByAuthor.get(authorKey) ?? {
      handle: post.author.handle,
      posts: [],
    };
    entry.posts.push(post);
    postsByAuthor.set(authorKey, entry);
  }
  const [owner, runnerUp] = [...postsByAuthor.values()].sort(
    (left, right) => right.posts.length - left.posts.length,
  );
  return owner === undefined || owner.posts.length === runnerUp?.posts.length ? undefined : owner;
}

/** The post times of a profile timeline's owner; undated posts carry no time and are skipped. */
export function timelineOwnerPosts(
  posts: ParsedXPost[],
  ownerId?: string,
): TimelineOwnerPosts | undefined {
  const owner: OwnerPosts | undefined = ownerPostsOf(
    posts.filter((post) => post.createdAt !== undefined),
    ownerId,
  );
  return owner === undefined
    ? undefined
    : {
        handle: owner.handle,
        timestamps: owner.posts.flatMap((post) =>
          post.createdAt === undefined ? [] : [post.createdAt],
        ),
      };
}

/**
 * The tweets of a replies tab's owner (`UserTweetsAndReplies`), reposts included as the owner's posts
 * like the cadence timestamps do. The replies tab pairs every reply with the tweet it answers, so
 * the owner and the other party tie on tweet count and the most-tweets fallback of the posts tab
 * would name no one: the owner must be the user the request named (`ownerId`, from
 * `variables.userId`), and without one nothing is counted.
 * GUESS: as for `profileTimelineUserIdOf`, the request is a GET carrying its variables.
 */
export function repliesTabOwnerTweets(
  posts: ParsedXPost[],
  ownerId: string | undefined,
): OwnerPosts | undefined {
  return ownerId === undefined ? undefined : ownerPostsOf(posts, ownerId);
}

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
