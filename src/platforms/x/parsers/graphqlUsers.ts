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
import type { AccountRef, PartialSignals, VerifiedKind } from "../../../core/types";
import { MAX_POST_TEXT_LENGTH } from "../../../core/types";

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

/** One post in a timeline body, attributed to its author. */
export interface ParsedXPost {
  id: string;
  author: AccountRef;
  text?: string;
  /** Epoch milliseconds. */
  createdAt?: number;
  /** Whether the post answers another post. A repost wrapper is never one. */
  isReply: boolean;
}

export interface ParsedXBody {
  users: ParsedXUser[];
  posts: ParsedXPost[];
}

const MAX_WALK_NODES = 200_000;
const MAX_USERS_PER_RESPONSE = 500;
const MAX_POSTS_PER_RESPONSE = 500;
const MAX_SINGLE_POST_TEXT_LENGTH = 1_000;
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

// MARK: - Posts

/** The text of a long post; `legacy.full_text` holds only its first 280 characters. */
function longPostTextOf(node: UnknownRecord): string | undefined {
  // GUESS: long posts carry their whole text at note_tweet.note_tweet_results.result.text, as X's
  // public payloads have; no recorded body under tests/fixtures/x/graphql/ contains a long post yet.
  const noteResult: UnknownRecord | undefined = readRecord(
    readRecord(readRecord(node, "note_tweet"), "note_tweet_results"),
    "result",
  );
  return readString(noteResult, "text");
}

/**
 * GUESS: a reply names the post it answers at legacy.in_reply_to_status_id_str (empty or absent on
 * any other post) and the answered user at legacy.in_reply_to_user_id_str, else
 * legacy.in_reply_to_screen_name; no recorded body under tests/fixtures/x/graphql/ carries a
 * replies tab yet. An answered user that is the author makes it a thread continuation, not a reply.
 */
function answersAnotherPost(legacy: UnknownRecord, author: AccountRef): boolean {
  if ((readString(legacy, "in_reply_to_status_id_str") ?? "") === "") {
    return false;
  }
  const answeredUserId: string | undefined = readString(legacy, "in_reply_to_user_id_str");
  if (answeredUserId !== undefined && answeredUserId !== "" && author.id !== undefined) {
    return answeredUserId !== author.id;
  }
  const answeredScreenName: string = readString(legacy, "in_reply_to_screen_name") ?? "";
  return answeredScreenName === "" || answeredScreenName.toLowerCase() !== author.handle;
}

/** A post object: its own `rest_id`, a `legacy` block, and its author under `core.user_results`. */
function asPost(node: UnknownRecord): ParsedXPost | undefined {
  const legacy: UnknownRecord | undefined = readRecord(node, "legacy");
  const authorNode: UnknownRecord | undefined = readRecord(
    readRecord(readRecord(node, "core"), "user_results"),
    "result",
  );
  const id: string | undefined = readString(node, "rest_id");
  const author: ParsedXUser | undefined = authorNode === undefined ? undefined : asUser(authorNode);
  if (id === undefined || legacy === undefined || author === undefined) {
    return undefined;
  }
  // A repost wrapper is never a reply, and neither is a thread continuation: a post answering its own
  // author is the author continuing a thread, which a human does as often as a bot.
  const isRepost: boolean = readRecord(legacy, "retweeted_status_result") !== undefined;
  const isReply: boolean = !isRepost && answersAnotherPost(legacy, author.ref);
  const post: ParsedXPost = { id, author: author.ref, isReply };
  // A repost's text is the reposted author's words, and their language is not this account's; the
  // reposted post itself is walked into and credited to its own author.
  const text: string | undefined = isRepost
    ? undefined
    : (longPostTextOf(node) ?? readString(legacy, "full_text"));
  if (text !== undefined) {
    post.text = text.slice(0, MAX_SINGLE_POST_TEXT_LENGTH);
  }
  // GUESS: a post's own time is legacy.created_at in X's weekday-first format, as on the user
  // object; the recorded timeline bodies under tests/fixtures/x/graphql/ do not carry it.
  const createdAt: number | undefined = parseXTimestamp(readString(legacy, "created_at"));
  if (createdAt !== undefined) {
    post.createdAt = createdAt;
  }
  return post;
}

// MARK: - Walk

/**
 * Every user object and every post anywhere in a GraphQL body, in document order, each deduplicated
 * by its `rest_id`. A post is walked into (its author, a quoted or reposted post), a user is not. The
 * walk is iterative and bounded so a hostile or enormous body cannot stall the content script.
 */
export function parseGraphqlBody(body: unknown): ParsedXBody {
  const users: ParsedXUser[] = [];
  const posts: ParsedXPost[] = [];
  const seenIds = new Set<string>();
  const visited = new WeakSet<object>();
  const pending: unknown[] = [body];
  let visitedCount = 0;
  while (pending.length > 0 && visitedCount < MAX_WALK_NODES) {
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
          if (users.length < MAX_USERS_PER_RESPONSE) {
            users.push(user);
          }
        }
        continue;
      }
      const post: ParsedXPost | undefined = asPost(node);
      if (post !== undefined && !seenIds.has(post.id) && posts.length < MAX_POSTS_PER_RESPONSE) {
        seenIds.add(post.id);
        posts.push(post);
      }
      children.push(...Object.values(node));
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return { users, posts };
}

export function collectUsers(body: unknown): ParsedXUser[] {
  return parseGraphqlBody(body).users;
}

/** Each author's post text in one body, joined in document order and capped for the detector. */
export function postTextByHandle(posts: ParsedXPost[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const post of posts) {
    if (post.text === undefined) {
      continue;
    }
    const earlier: string | undefined = texts.get(post.author.handle);
    const joined: string = earlier === undefined ? post.text : `${earlier}\n${post.text}`;
    texts.set(post.author.handle, joined.slice(0, MAX_POST_TEXT_LENGTH));
  }
  return texts;
}

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
