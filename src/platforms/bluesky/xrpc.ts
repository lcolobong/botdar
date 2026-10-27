/**
 * The XRPC operations the Bluesky web app calls for feeds, threads and profiles, shared by the
 * MAIN-world interceptor (which matches request URLs) and the isolated-world passive source (which
 * picks the parser). The web app talks to its own PDS or AppView host, so matching is by path only.
 */

export const BLUESKY_RELAY_KIND = "bsky.xrpc";

/** A profile's own feed, which the web app fetches when someone opens the profile. */
export const AUTHOR_FEED_OPERATION = "app.bsky.feed.getAuthorFeed";

/**
 * The one author-feed population the cadence features read: the account's posts and its own
 * threads, the profile's Posts tab. Botdar's lookup asks for it, and a relayed body counts only when
 * the page asked for the same, so the replies and media tabs never mix with it.
 * GUESS: the web app's Posts tab requests filter=posts_and_author_threads (the lexicon's default is
 * posts_with_replies); no recorded request confirms it. If it asks for another filter, relayed
 * bodies add no post times and the hover lookup still supplies them.
 */
export const AUTHOR_FEED_FILTER = "posts_and_author_threads";
/** The author feed's request query is relayed with its body, capped, for its filter. */
export const MAX_RELAYED_QUERY_LENGTH = 2048;

/** The `filter` the page's getAuthorFeed request named, from its relayed query string. */
export function authorFeedFilterOf(query: string | undefined): string | undefined {
  return query === undefined ? undefined : (new URLSearchParams(query).get("filter") ?? undefined);
}

export const FEED_OPERATIONS: readonly string[] = [
  "app.bsky.feed.getTimeline",
  "app.bsky.feed.getFeed",
  AUTHOR_FEED_OPERATION,
  "app.bsky.feed.getPostThread",
];

export const PROFILE_OPERATIONS: readonly string[] = [
  "app.bsky.actor.getProfiles",
  "app.bsky.actor.getProfile",
];

const XRPC_PATH_SEGMENT = "/xrpc/";

/** The intercepted operation named by a request URL, or undefined when the request is not one. */
export function xrpcOperationOf(url: string, base: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(url, base).pathname;
  } catch {
    return undefined;
  }
  const segmentIndex: number = pathname.indexOf(XRPC_PATH_SEGMENT);
  if (segmentIndex < 0) {
    return undefined;
  }
  const operation: string = pathname.slice(segmentIndex + XRPC_PATH_SEGMENT.length);
  return FEED_OPERATIONS.includes(operation) || PROFILE_OPERATIONS.includes(operation)
    ? operation
    : undefined;
}
