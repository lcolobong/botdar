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

export const X_GRAPHQL_OPERATIONS: ReadonlySet<string> = new Set([
  "HomeTimeline",
  "HomeLatestTimeline",
  "SearchTimeline",
  "UserTweets",
  "UserTweetsAndReplies",
  "TweetDetail",
  "UserByScreenName",
  ABOUT_ACCOUNT_OPERATION,
  "Followers",
  "Following",
]);

export interface GraphqlOperation {
  op: string;
  queryId: string;
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
  return queryId === undefined || op === undefined ? undefined : { op, queryId };
}
