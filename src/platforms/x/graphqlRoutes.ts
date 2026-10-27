/**
 * The X GraphQL routes both worlds agree on: the relay kinds, the operations whose responses carry
 * user objects (docs/architecture.md, "X"), and the URL matcher. Kept free of DOM and extension
 * imports so the MAIN-world bundle that includes it stays tiny.
 */

/** Response bodies of allowlisted operations. */
export const X_GRAPHQL_RELAY_KIND = "x.graphql";
/** `{ op, queryId }` of every outgoing GraphQL request, so the query id registry can learn ids. */
export const X_GRAPHQL_REQUEST_RELAY_KIND = "x.graphql.request";

export const ABOUT_ACCOUNT_OPERATION = "AboutAccountQuery";

/**
 * A profile's own posts, which the page fetches when someone opens the profile and scrolls. Only
 * this tab feeds the cadence features: the replies tab (`UserTweetsAndReplies`) is a different
 * population of posts, and mixing the two would mix two rhythms.
 */
export const PROFILE_TIMELINE_OPERATION = "UserTweets";
/**
 * A profile's replies tab. Its tweets are not the cadence population, but they are the one place a
 * reply share can be counted, since the posts tab holds no replies.
 */
export const PROFILE_REPLIES_OPERATION = "UserTweetsAndReplies";
/** The profile timelines' request query is relayed with their body, capped, for the owner's id. */
export const MAX_RELAYED_QUERY_LENGTH = 4096;

export const X_GRAPHQL_OPERATIONS: ReadonlySet<string> = new Set([
  "HomeTimeline",
  "HomeLatestTimeline",
  "SearchTimeline",
  PROFILE_TIMELINE_OPERATION,
  PROFILE_REPLIES_OPERATION,
  "TweetDetail",
  "UserByScreenName",
  ABOUT_ACCOUNT_OPERATION,
  "Followers",
  "Following",
]);

export interface GraphqlOperation {
  op: string;
  queryId: string;
  /** The request's query string, for the profile timelines only (it names the profile's user). */
  query?: string;
}

const GRAPHQL_PATH_PATTERN = /^\/i\/api\/graphql\/([A-Za-z0-9_-]{15,40})\/([A-Za-z0-9_]{1,64})$/;
const X_HOST_PATTERN = /(^|\.)(x|twitter)\.com$/;

/** The operation named by a request URL on an X host, or undefined for anything else. */
export function matchGraphqlOperation(url: string, base: string): GraphqlOperation | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return undefined;
  }
  if (!X_HOST_PATTERN.test(parsed.hostname)) {
    return undefined;
  }
  const match: RegExpExecArray | null = GRAPHQL_PATH_PATTERN.exec(parsed.pathname);
  const [, queryId, op] = match ?? [];
  if (queryId === undefined || op === undefined) {
    return undefined;
  }
  const namesProfile: boolean =
    op === PROFILE_TIMELINE_OPERATION || op === PROFILE_REPLIES_OPERATION;
  return namesProfile && parsed.search.length <= MAX_RELAYED_QUERY_LENGTH
    ? { op, queryId, query: parsed.search }
    : { op, queryId };
}
