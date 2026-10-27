/**
 * Post times from an `app.bsky.feed.getAuthorFeed` body, for the cadence features. The web app's own
 * request (Tier 1, relayed) and the public AppView's answer to Botdar's lookup (Tier 2) follow the
 * same lexicon. Bodies are untrusted: every read is type-guarded, the item count is capped, and
 * nothing here throws. The times are returned as the body carried them; the pipeline normalises.
 */
import type { UnknownRecord } from "../../../core/json/untrusted";
import { isRecord, isoTimestampMillis, readRecord, readString } from "../../../core/json/untrusted";

export interface AuthorFeedPosts {
  did: string;
  /** Lowercased, as the pipeline keys accounts. */
  handle: string;
  /** Epoch milliseconds, in the body's order. */
  timestamps: number[];
}

/** A page of the web app's profile feed holds 30 or so items; the lexicon caps a request at 100. */
const MAX_FEED_ITEMS = 200;
/**
 * A repost's post is someone else's, and its time says nothing about this account's rhythm (the
 * recorded get-author-feed.json item is one). A pinned post (`#reasonPin`) is the account's own.
 */
const REPOST_REASON_TYPE = "app.bsky.feed.defs#reasonRepost";

/**
 * The AppView's `indexedAt`, else the record's `createdAt`. The server assigns `indexedAt`; the
 * client writes `createdAt` and may write anything, such as a date in 2099 to pin a post to the top
 * of reverse-chronological feeds, so it is used only when the server time is missing (and the
 * pipeline drops a time in the future either way).
 */
function postTimeOf(post: UnknownRecord): number | undefined {
  return (
    isoTimestampMillis(readString(post, "indexedAt")) ??
    isoTimestampMillis(readString(readRecord(post, "record"), "createdAt"))
  );
}

/** Each author's own post times in a getAuthorFeed body, reposts left out. */
export function authorFeedPosts(body: unknown): AuthorFeedPosts[] {
  const feed: unknown = isRecord(body) ? body.feed : undefined;
  if (!Array.isArray(feed)) {
    return [];
  }
  const byDid = new Map<string, AuthorFeedPosts>();
  for (const item of feed.slice(0, MAX_FEED_ITEMS)) {
    const itemRecord: UnknownRecord | undefined = isRecord(item) ? item : undefined;
    const post: UnknownRecord | undefined = readRecord(itemRecord, "post");
    const author: UnknownRecord | undefined = readRecord(post, "author");
    const did: string | undefined = readString(author, "did");
    const handle: string | undefined = readString(author, "handle")?.trim().toLowerCase();
    const reasonType: string | undefined = readString(readRecord(itemRecord, "reason"), "$type");
    const postedAt: number | undefined = post === undefined ? undefined : postTimeOf(post);
    if (
      did === undefined ||
      handle === undefined ||
      handle.length === 0 ||
      postedAt === undefined ||
      reasonType === REPOST_REASON_TYPE
    ) {
      continue;
    }
    const entry: AuthorFeedPosts = byDid.get(did) ?? { did, handle, timestamps: [] };
    entry.timestamps.push(postedAt);
    byDid.set(did, entry);
  }
  return [...byDid.values()];
}
