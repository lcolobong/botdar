/**
 * A reply on an X post page as the thread index records it (ADR-0027). The page at
 * `/<user>/status/<id>` is one thread: the post it names is the root, the posts above it are its
 * ancestors and the posts after it are replies. X assigns status ids from the clock on its servers
 * (snowflake ids), so a reply is a post whose id is greater than the root's, and the id itself is
 * the reply's time, to the millisecond, with no need for the rendered timestamp and no way for an
 * author to backdate it. Id order alone is not membership: X also puts promoted posts among the
 * replies and appends posts from elsewhere under a section heading below the conversation, all
 * newer than the root, so both are turned away.
 */
import type { ThreadReply } from "../../core/thread/threadIndex";
import { textOutside } from "../../core/thread/replyText";
import { POST_TEXT_SELECTOR, authorHandleOf } from "./dom";

const PAGE_STATUS_PATTERN = /^\/[^/]+\/status\/(\d+)/;
const STATUS_LINK_PATTERN = /\/status\/(\d+)/;
/** The post's own timestamp link; its href carries the status id. */
const STATUS_TIME_SELECTOR = 'a[href*="/status/"] time';
/**
 * GUESS: a quoted post renders inside the article as a `div` with `role="link"` (X gives its plain
 * anchors that role too, hence the tag), holding its own timestamp link and post text; neither
 * belongs to the reply. Not yet confirmed on a recording.
 */
const QUOTED_POST_SELECTOR = 'div[role="link"]';
/** GUESS: a promoted post's content sits in this wrapper. Not yet confirmed on a recording. */
const PROMOTED_POST_SELECTOR = '[data-testid="placementTracking"]';
/**
 * GUESS: the section X appends under the conversation opens with a heading whose text starts with
 * one of these (English interface only). Not yet confirmed on a recording.
 */
const SECTION_HEADING_SELECTOR = '[role="heading"], h2';
const OFF_THREAD_HEADING_PREFIXES: readonly string[] = ["discover more", "more posts"];
/** Node.DOCUMENT_POSITION_FOLLOWING, spelled out so the module loads without a DOM. */
const DOCUMENT_POSITION_FOLLOWING = 4;
const SNOWFLAKE_TIMESTAMP_SHIFT = BigInt(22);
/** 2010-11-04T01:42:54.657Z, the epoch X's snowflake ids count from. */
const SNOWFLAKE_EPOCH_MILLIS = 1_288_834_974_657;

/** The status id the page names, or undefined on any page that is not a single post's thread. */
export function threadKeyOf(pageUrl: URL): string | undefined {
  return PAGE_STATUS_PATTERN.exec(pageUrl.pathname)?.[1];
}

/** Epoch milliseconds a status id was assigned at. */
export function snowflakeMillis(statusId: string): number {
  return Number(BigInt(statusId) >> SNOWFLAKE_TIMESTAMP_SHIFT) + SNOWFLAKE_EPOCH_MILLIS;
}

function outsideQuotedPost(element: Element, article: Element): boolean {
  const card: Element | null = element.closest(QUOTED_POST_SELECTOR);
  return card === null || !article.contains(card);
}

function statusIdOf(article: Element): string | undefined {
  for (const time of article.querySelectorAll(STATUS_TIME_SELECTOR)) {
    if (outsideQuotedPost(time, article)) {
      const href: string = time.closest("a")?.getAttribute("href") ?? "";
      return STATUS_LINK_PATTERN.exec(href)?.[1];
    }
  }
  return undefined;
}

/** The heading that ends the conversation, when it is rendered. */
export function offThreadHeadingOf(document: Document): Element | undefined {
  return [...document.querySelectorAll(SECTION_HEADING_SELECTOR)].find((heading) => {
    const text: string = (heading.textContent ?? "").trim().toLowerCase();
    return OFF_THREAD_HEADING_PREFIXES.some((prefix) => text.startsWith(prefix));
  });
}

function belowHeading(article: Element, heading: Element | undefined): boolean {
  return (
    heading !== undefined &&
    (heading.compareDocumentPosition(article) & DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

function ownTextOf(article: Element): string | undefined {
  const text: Element | undefined = [...article.querySelectorAll(POST_TEXT_SELECTOR)].find(
    (element) => outsideQuotedPost(element, article),
  );
  return text === undefined ? undefined : textOutside(text, QUOTED_POST_SELECTOR);
}

/**
 * The article as a reply in the page's thread, or undefined for the root, an ancestor, a promoted
 * post, a post below the conversation's closing heading or any other page. A reply with no text
 * (X hides a lone link behind its card) is still one: its links arrive by status id from Tier 1.
 */
export function threadReplyOf(
  article: Element,
  pageUrl: URL,
  closingHeading: Element | undefined = offThreadHeadingOf(article.ownerDocument),
): ThreadReply | undefined {
  const rootId: string | undefined = threadKeyOf(pageUrl);
  // Every feed page asks too, so a page that is not a thread is turned away before any DOM read.
  if (rootId === undefined) {
    return undefined;
  }
  if (
    belowHeading(article, closingHeading) ||
    article.querySelector(PROMOTED_POST_SELECTOR) !== null
  ) {
    return undefined;
  }
  const replyId: string | undefined = statusIdOf(article);
  if (replyId === undefined || BigInt(replyId) <= BigInt(rootId)) {
    return undefined;
  }
  const author: string | undefined = authorHandleOf(article);
  if (author === undefined) {
    return undefined;
  }
  return {
    threadKey: rootId,
    replyId,
    author,
    text: ownTextOf(article) ?? "",
    postedAt: snowflakeMillis(replyId),
  };
}

export interface XReplyReader {
  read: (article: Element) => ThreadReply | undefined;
  /** The page navigated: the conversation's closing heading has not been seen on the new one. */
  reset: () => void;
}

/**
 * The page's reader. X virtualises its list, so once the reader has scrolled past the conversation
 * its closing heading leaves the DOM while posts from elsewhere keep rendering under it. After the
 * heading has been seen, a post read while it is absent is therefore treated as off the thread; the
 * replies above the heading were rendered, and recorded, before it appeared, so a reply re-rendered
 * on the way back up is already in the index.
 */
export function createXReplyReader(target: Window): XReplyReader {
  let closingHeadingSeen = false;
  return {
    read: (article) => {
      const pageUrl = new URL(target.location.href);
      if (threadKeyOf(pageUrl) === undefined) {
        return undefined;
      }
      const closingHeading: Element | undefined = offThreadHeadingOf(article.ownerDocument);
      if (closingHeading !== undefined) {
        closingHeadingSeen = true;
      } else if (closingHeadingSeen) {
        return undefined;
      }
      return threadReplyOf(article, pageUrl, closingHeading);
    },
    reset: () => {
      closingHeadingSeen = false;
    },
  };
}
