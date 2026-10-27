/**
 * A Reddit comment as the thread index records it (ADR-0027). Every comment on a post page answers
 * the post or another comment, so each `shreddit-comment` is a reply in the thread its `postid`
 * names, and the post itself (`shreddit-post`) is never recorded. old.reddit is not read: its
 * comments carry no thread or parent ids as attributes.
 *
 * Every selector not confirmed against a live recording is marked GUESS, as in dom.ts.
 */
import type { ReplyReading } from "../../core/thread/replyText";
import { NOT_YET_READABLE, pageTimestampMillis, textOutside } from "../../core/thread/replyText";
import { COMMENT_SELECTOR, authorNameOf } from "./dom";

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
  };
}
