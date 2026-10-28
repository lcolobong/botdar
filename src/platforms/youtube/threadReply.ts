/**
 * A YouTube comment as the thread index records it (ADR-0027, ADR-0029). A thread is a watch page's
 * comment section, keyed by the video id: every comment answers the video, and a reply answers its
 * thread's top-level comment, whose id prefixes its own ("<thread id>.<reply id>"). The video's
 * description is the root, read for its links. Recorded on 2026-10-27
 * (tests/fixtures/youtube/html/watch.html).
 *
 * A comment shows its age only as relative text ("1 hour ago", "2 days ago (edited)"), read in
 * English, relative to when it was rendered. Its time is the start of that span before the moment
 * the comment is read, so a comment loaded twenty minutes into the visit is dated from then, and two
 * comments in the same span tie and neither counts as the other's source. Inside one comment thread
 * replies render in the order they were posted, so there the order on the page breaks the tie.
 */
import type { ReplyReading, ThreadRootLinks } from "../../core/thread/replyText";
import { NOT_YET_READABLE, linksField } from "../../core/thread/replyText";
import { YOUTUBE_ORIGIN } from "./conventions";
import type { YouTubeComment } from "./dom";
import { classify } from "./dom";

const WATCH_PATH = "/watch";
const VIDEO_PARAMETER = "v";
const COMMENT_TEXT_SELECTOR = "#content-text";
const PUBLISHED_LINK_SELECTOR = "#published-time-text a[href]";
const COMMENT_ID_PARAMETER = "lc";
const REPLY_ID_SEPARATOR = ".";
const THREAD_SELECTOR = "ytd-comment-thread-renderer:not([is-sub-thread])";
const LINK_SELECTOR = "a[href]";
const DESCRIPTION_LINKS_SELECTOR = `ytd-watch-metadata #description ${LINK_SELECTOR}`;
const REDIRECT_PATH = "/redirect";
const REDIRECT_TARGET_PARAMETER = "q";
const AGE_PATTERN = /^(\d+) (second|minute|hour|day|week|month|year)s? ago/;
const UNIT_MILLIS: Readonly<Record<string, number>> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_746_000,
  year: 31_556_952_000,
};
/** Below the shortest span ("1 second ago"), so the order on the page never crosses a span. */
const MAX_THREAD_ORDINAL = 999;

/** The video id of a watch page, or undefined on any other page. */
export function threadKeyOf(pageUrl: URL): string | undefined {
  return pageUrl.pathname === WATCH_PATH
    ? (pageUrl.searchParams.get(VIDEO_PARAMETER) ?? undefined)
    : undefined;
}

/** How long ago "3 hours ago" was, as the start of its span; undefined for other text. */
export function relativeAgeMillis(text: string): number | undefined {
  const match: RegExpExecArray | null = AGE_PATTERN.exec(text.trim());
  const unit: number | undefined = UNIT_MILLIS[match?.[2] ?? ""];
  return match === null || unit === undefined ? undefined : Number(match[1]) * unit;
}

/**
 * The links a comment or description carries, with YouTube's outbound wrapper
 * (`/redirect?…&q=<target>`) undone. Links within YouTube (timestamps, hashtags, mentions) are left
 * out; their domain never counts. GUESS for comments: the wrapper was recorded on the description
 * only, as no recorded comment links out.
 */
export function outboundLinksOf(anchors: Iterable<Element>): string[] {
  const links: string[] = [];
  for (const anchor of anchors) {
    let url: URL;
    try {
      url = new URL(anchor.getAttribute("href") ?? "", `${YOUTUBE_ORIGIN}/`);
    } catch {
      continue;
    }
    if (url.origin !== YOUTUBE_ORIGIN) {
      links.push(url.href);
    } else if (url.pathname === REDIRECT_PATH) {
      const target: string | null = url.searchParams.get(REDIRECT_TARGET_PARAMETER);
      if (target !== null && /^https?:\/\//.test(target)) links.push(target);
    }
  }
  return links;
}

function commentIdOf(element: Element): string | undefined {
  const href: string = element.querySelector(PUBLISHED_LINK_SELECTOR)?.getAttribute("href") ?? "";
  try {
    return new URL(href, `${YOUTUBE_ORIGIN}/`).searchParams.get(COMMENT_ID_PARAMETER) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Each comment's place in its comment thread, counted as comments are first read. Discovery reads a
 * subtree in page order and later replies are appended after earlier ones, so this is page order,
 * without walking the thread again for every comment. One per page: the adapter starts a new one
 * when the app moves on.
 */
export class ThreadOrdinals {
  private readonly nextByThread = new WeakMap<Element, number>();
  private readonly ordinalByComment = new WeakMap<Element, number>();

  ordinalOf(comment: Element): number {
    const known: number | undefined = this.ordinalByComment.get(comment);
    if (known !== undefined) return known;
    const thread: Element = comment.closest(THREAD_SELECTOR) ?? comment;
    const ordinal: number = Math.min(this.nextByThread.get(thread) ?? 0, MAX_THREAD_ORDINAL);
    this.nextByThread.set(thread, ordinal + 1);
    this.ordinalByComment.set(comment, ordinal);
    return ordinal;
  }
}

/**
 * The comment as a reply in the page's thread, dated from `readAt`. NOT_YET_READABLE while Polymer
 * has not bound its author or its id yet; undefined off a watch page and for anything that is not a
 * comment, or whose age reads in no language this parses.
 */
export function threadReplyOf(
  element: Element,
  pageUrl: URL,
  ordinals: ThreadOrdinals,
  classified: YouTubeComment = classify(element),
  readAt: number = Date.now(),
): ReplyReading {
  const threadKey: string | undefined = threadKeyOf(pageUrl);
  if (threadKey === undefined || classified.status === "notComment") return undefined;
  const ordinal: number = ordinals.ordinalOf(element);
  const replyId: string | undefined = commentIdOf(element);
  if (classified.status === "unreadableAuthor" || replyId === undefined) return NOT_YET_READABLE;
  const ageText: string = element.querySelector(PUBLISHED_LINK_SELECTOR)?.textContent ?? "";
  const age: number | undefined = relativeAgeMillis(ageText);
  const commentText: Element | null = element.querySelector(COMMENT_TEXT_SELECTOR);
  if (age === undefined || commentText === null) return undefined;
  const separator: number = replyId.indexOf(REPLY_ID_SEPARATOR);
  return {
    threadKey,
    replyId,
    author: classified.post.ref.handle,
    text: commentText.textContent ?? "",
    postedAt: readAt - age + ordinal,
    ...(separator > 0 ? { parentId: replyId.slice(0, separator) } : {}),
    ...linksField(outboundLinksOf(commentText.querySelectorAll(LINK_SELECTOR))),
  };
}

/** The video's description, read for the links that never count for its comments. */
export function threadRootLinksOf(doc: Document, pageUrl: URL): ThreadRootLinks | undefined {
  const threadKey: string | undefined = threadKeyOf(pageUrl);
  if (threadKey === undefined) return undefined;
  return { threadKey, links: outboundLinksOf(doc.querySelectorAll(DESCRIPTION_LINKS_SELECTOR)) };
}
