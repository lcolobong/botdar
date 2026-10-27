/**
 * A Reddit comment as the thread index records it (ADR-0027). Every comment on a post page answers
 * the post or another comment, so each `shreddit-comment` is a reply in the thread its `postid`
 * names, and the post itself (`shreddit-post`) is never recorded. old.reddit is not read: its
 * comments carry no thread or parent ids as attributes.
 *
 * Every selector not confirmed against a live recording is marked GUESS, as in dom.ts.
 */
import type { ReplyReading, ThreadRootLinks } from "../../core/thread/replyText";
import {
  NOT_YET_READABLE,
  linksField,
  pageTimestampMillis,
  textOutside,
  webLinksIn,
} from "../../core/thread/replyText";
import { COMMENT_SELECTOR, POST_SELECTOR, authorNameOf } from "./dom";

/**
 * GUESS: the comment body is light DOM slotted as "comment", after the meta row. Both Reddit
 * fixtures that show it (comments.html, copied-replies.html) are hand-written, not recorded.
 */
const COMMENT_BODY_SLOT = "comment";
/**
 * The meta row's relative time. `faceplate-timeago` was seen on the live feed's post cards
 * (recorded 2026-10-25, dom.ts); its absolute `ts` attribute on a comment is a GUESS taken from the
 * hand-written comments.html until a comment thread is recorded.
 */
const COMMENT_TIME_TAG = "faceplate-timeago";
const COMMENT_TIME_ATTRIBUTE = "ts";
/** Reddit's Markdown quote ("> …"): someone else's words, quoted to answer them. */
const QUOTE_SELECTOR = "blockquote";
/** A post page's path names the post: `/r/<sub>/comments/<id>/<slug>/`. */
const POST_PAGE_PATTERN = /\/comments\/([a-z0-9]+)/i;
const POST_FULLNAME_PREFIX = "t3_";
/** GUESS: a link post's target URL, as an attribute of `shreddit-post`. Not on a recording yet. */
const POST_LINK_ATTRIBUTE = "content-href";
/** GUESS: a text post's body, slotted into `shreddit-post` as light DOM. Not on a recording yet. */
const POST_BODY_SELECTOR = '[slot="text-body"]';

interface OwnParts {
  body: Element | undefined;
  time: Element | undefined;
}

/**
 * Fills in the comment's body and meta-row time from its own markup, never descending into a reply:
 * a top-level comment holds its whole reply tree, and every comment on the page is read when it is
 * discovered, so this compares tag names and attributes rather than matching selectors. The meta row
 * comes first, so the walk stops at the body; true once it is found.
 */
function findOwnParts(element: Element, parts: OwnParts): boolean {
  for (const child of element.children) {
    if (child.localName === COMMENT_SELECTOR) {
      continue;
    }
    if (child.getAttribute("slot") === COMMENT_BODY_SLOT) {
      parts.body = child;
      return true;
    }
    if (
      parts.time === undefined &&
      child.localName === COMMENT_TIME_TAG &&
      child.hasAttribute(COMMENT_TIME_ATTRIBUTE)
    ) {
      parts.time = child;
    }
    if (findOwnParts(child, parts)) {
      return true;
    }
  }
  return false;
}

function ownPartsOf(comment: Element): OwnParts {
  const parts: OwnParts = { body: undefined, time: undefined };
  findOwnParts(comment, parts);
  return parts;
}

function nonEmptyAttribute(element: Element, name: string): string | undefined {
  const value: string = element.getAttribute(name)?.trim() ?? "";
  return value.length > 0 ? value : undefined;
}

/**
 * The comment as a reply in its post's thread; undefined for a post or a comment with no usable
 * author or ids, and NOT_YET_READABLE for one whose body or time has not been slotted in yet.
 */
export function threadReplyOf(element: Element): ReplyReading {
  if (element.tagName.toLowerCase() !== COMMENT_SELECTOR) {
    return undefined;
  }
  const threadKey: string | undefined = nonEmptyAttribute(element, "postid");
  const replyId: string | undefined = nonEmptyAttribute(element, "thingid");
  const author: string | undefined = authorNameOf(element)?.toLowerCase();
  if (threadKey === undefined || replyId === undefined || author === undefined) {
    return undefined;
  }
  const { body, time }: OwnParts = ownPartsOf(element);
  const postedAt: number | undefined = pageTimestampMillis(
    time?.getAttribute(COMMENT_TIME_ATTRIBUTE) ?? "",
  );
  if (body === undefined || postedAt === undefined) {
    return NOT_YET_READABLE;
  }
  const parentId: string | undefined = nonEmptyAttribute(element, "parentid");
  return {
    threadKey,
    replyId,
    author,
    text: textOutside(body, QUOTE_SELECTOR),
    postedAt,
    ...(parentId === undefined ? {} : { parentId }),
    ...linksField(webLinksIn(body, QUOTE_SELECTOR)),
  };
}

/**
 * The post the page is about, read for the links it carries: a link post's target and the links
 * in a text post's body. Undefined for every other element, and for a post in a feed;
 * NOT_YET_READABLE while neither the target nor the body is in the DOM, so the post's own site is
 * not settled as linking nothing (an image post, which has neither, is read again on later passes).
 */
export function threadRootLinksOf(
  element: Element,
  pageUrl: URL,
): ThreadRootLinks | undefined | typeof NOT_YET_READABLE {
  const postId: string | undefined = POST_PAGE_PATTERN.exec(pageUrl.pathname)?.[1];
  if (
    element.localName !== POST_SELECTOR ||
    postId === undefined ||
    element.id !== `${POST_FULLNAME_PREFIX}${postId}`
  ) {
    return undefined;
  }
  const target: string | undefined = nonEmptyAttribute(element, POST_LINK_ATTRIBUTE);
  const body: Element | null = element.querySelector(POST_BODY_SELECTOR);
  if (target === undefined && body === null) {
    return NOT_YET_READABLE;
  }
  return {
    threadKey: element.id,
    links: [...(target === undefined ? [] : [target]), ...(body === null ? [] : webLinksIn(body))],
  };
}
