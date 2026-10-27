import { isRecord, readString } from "@/src/core/json/untrusted";
import type { ParsedXPost } from "./types";

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
