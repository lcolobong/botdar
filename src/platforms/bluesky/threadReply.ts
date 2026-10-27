/**
 * A reply on a bsky.app post page as the thread index records it (ADR-0027). The page at
 * `/profile/<actor>/post/<rkey>` is one thread: the post it names is the root, the posts above it
 * are its ancestors and the posts after it are replies. A post's record key is a TID, a timestamp
 * in microseconds, so a reply is a post whose key is later than the root's and the key is its time.
 *
 * Unlike X's ids, a TID is written by the author's client, so an account can backdate one; ADR-0027
 * records what that allows. Every selector here is a GUESS, like those in dom.ts, until a thread
 * page has been recorded.
 */
import type { ThreadReply } from "../../core/thread/threadIndex";
import { authorHandleOf } from "./dom";

const POST_PATH_PATTERN = /^\/profile\/([^/]+)\/post\/([^/?#]+)/;
/** GUESS: every link to a post, the timestamp link included, is `/profile/<actor>/post/<rkey>`. */
const POST_LINK_SELECTOR = 'a[href^="/profile/"][href*="/post/"]';
/**
 * GUESS: the post's own text carries this test id; a quoted post's text renders without it, and a
 * quoted post follows the author's own text, so the first match is the reply's.
 */
const POST_TEXT_SELECTOR = '[data-testid="postText"]';
const DID_PREFIX = "did:";
const TID_PATTERN = /^[2-7a-z]{13}$/;
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const TID_BITS_PER_CHARACTER = BigInt(5);
/** The low ten bits of a TID are a clock id; the rest is the time in microseconds. */
const TID_CLOCK_ID_BITS = BigInt(10);
const MICROSECONDS_PER_MILLISECOND = BigInt(1000);

/** Epoch milliseconds a TID record key encodes, or undefined for a key that is not a TID. */
export function tidMillis(recordKey: string): number | undefined {
  if (!TID_PATTERN.test(recordKey)) {
    return undefined;
  }
  let value = BigInt(0);
  for (const character of recordKey) {
    value = (value << TID_BITS_PER_CHARACTER) | BigInt(TID_ALPHABET.indexOf(character));
  }
  return Number((value >> TID_CLOCK_ID_BITS) / MICROSECONDS_PER_MILLISECOND);
}

/** The root post's record key, or undefined on any page that is not a single post's thread. */
export function threadKeyOf(pageUrl: URL): string | undefined {
  return POST_PATH_PATTERN.exec(pageUrl.pathname)?.[2];
}

/** The record key of the item's own post: the first post link to its author, by handle or DID. */
function recordKeyOf(item: Element, author: string): string | undefined {
  for (const link of item.querySelectorAll(POST_LINK_SELECTOR)) {
    const match: RegExpExecArray | null = POST_PATH_PATTERN.exec(link.getAttribute("href") ?? "");
    const actor: string | undefined = match?.[1]?.toLowerCase();
    if (actor === author || actor?.startsWith(DID_PREFIX) === true) {
      return match?.[2];
    }
  }
  return undefined;
}

/** The thread item as a reply, or undefined for the root, an ancestor or any other page. */
export function threadReplyOf(item: Element, pageUrl: URL): ThreadReply | undefined {
  const rootKey: string | undefined = threadKeyOf(pageUrl);
  const author: string | undefined = authorHandleOf(item);
  const rootMillis: number | undefined = rootKey === undefined ? undefined : tidMillis(rootKey);
  if (rootKey === undefined || author === undefined || rootMillis === undefined) {
    return undefined;
  }
  const replyKey: string | undefined = recordKeyOf(item, author);
  const postedAt: number | undefined = replyKey === undefined ? undefined : tidMillis(replyKey);
  const text: string | undefined = item.querySelector(POST_TEXT_SELECTOR)?.textContent ?? undefined;
  if (replyKey === undefined || postedAt === undefined || postedAt <= rootMillis) {
    return undefined;
  }
  return text === undefined
    ? undefined
    : { threadKey: rootKey, replyId: `${author}/${replyKey}`, author, text, postedAt };
}
