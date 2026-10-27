/**
 * Tier 2 for Bluesky's cadence features: the author's recent posts from
 * `app.bsky.feed.getAuthorFeed` on the public AppView, which needs no auth and answers with CORS
 * `*`. One request per hovered author (the lexicon serves one actor per call, so nothing batches);
 * the pipeline's limiter spends a token on it and its 24-hour cache answers repeats, and the
 * policy's Tier 2 switch turns it off with getProfiles. A 429 is reported so the limiter backs off.
 */
import { RateLimitedError } from "../../../core/ratelimit";
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "../../../core/types";
import type { AuthorFeedPosts } from "../parsers/authorFeed";
import { authorFeedPosts } from "../parsers/authorFeed";
import { AUTHOR_FEED_FILTER } from "../xrpc";
import { retryAfterMsOf } from "./getProfiles";

export const GET_AUTHOR_FEED_SOURCE_ID = "bluesky.getAuthorFeed";
export const GET_AUTHOR_FEED_ENDPOINT =
  "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
/** The lexicon's maximum, and as many posts as the cadence features read. */
const FEED_LIMIT = 100;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface GetAuthorFeedSourceOptions {
  fetch?: typeof globalThis.fetch;
  endpoint?: string;
}

function postsOf(ref: AccountRef, feeds: AuthorFeedPosts[]): AuthorFeedPosts | undefined {
  return feeds.find(
    (feed) => feed.handle === ref.handle || (ref.id !== undefined && feed.did === ref.id),
  );
}

export function createGetAuthorFeedSource(options: GetAuthorFeedSourceOptions = {}): SignalSource {
  const fetchFn: typeof globalThis.fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const endpoint: string = options.endpoint ?? GET_AUTHOR_FEED_ENDPOINT;

  const resolve = async (
    ref: AccountRef,
    context: ResolveContext,
  ): Promise<PartialSignals | null> => {
    const url = new URL(endpoint);
    url.searchParams.set("actor", ref.id ?? ref.handle);
    url.searchParams.set("limit", String(FEED_LIMIT));
    url.searchParams.set("filter", AUTHOR_FEED_FILTER);
    // No credentials: this is a sanctioned anonymous read, so the user's session is never involved.
    const response: Response = await fetchFn(url, {
      signal: context.signal,
      credentials: "omit",
      headers: { accept: "application/json" },
    });
    if (response.status === HTTP_TOO_MANY_REQUESTS) {
      throw new RateLimitedError("getAuthorFeed rate limited", retryAfterMsOf(response));
    }
    if (!response.ok) {
      throw new Error(`getAuthorFeed http ${response.status}`);
    }
    const posts: AuthorFeedPosts | undefined = postsOf(ref, authorFeedPosts(await response.json()));
    return posts === undefined ? null : { postTimestamps: posts.timestamps };
  };

  return {
    id: GET_AUTHOR_FEED_SOURCE_ID,
    platform: "bluesky",
    tier: 2,
    kind: "active",
    // Post times are never written to storage, so a stored getProfiles snapshot still leaves this
    // call to run on a hover.
    memoryOnly: true,
    resolve,
  };
}
