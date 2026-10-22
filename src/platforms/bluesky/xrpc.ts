/**
 * The XRPC operations the Bluesky web app calls for feeds, threads and profiles, shared by the
 * MAIN-world interceptor (which matches request URLs) and the isolated-world passive source (which
 * picks the parser). The web app talks to its own PDS or AppView host, so matching is by path only.
 */

export const BLUESKY_RELAY_KIND = "bsky.xrpc";

export const FEED_OPERATIONS: readonly string[] = [
  "app.bsky.feed.getTimeline",
  "app.bsky.feed.getFeed",
  "app.bsky.feed.getAuthorFeed",
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
