/**
 * Tier 0 for YouTube: what a watch page shows about a comment's author and about the video's
 * creator. Recorded on 2026-10-27 (tests/fixtures/youtube/html/watch.html):
 *
 * - every comment and reply is a `ytd-comment-view-model`; a reply carries `is-reply` and sits in
 *   its thread's `ytd-comment-replies-renderer`, and a view model never contains another one;
 * - the author is the `#author-text` link to `/@<handle>` (percent-encoded outside ASCII), with
 *   the handle as its text: a comment shows no display name;
 * - the creator is the watch metadata's owner link (`/@<handle>`, its name as the link text).
 *
 * The creator chip on a comment the creator wrote was not on the recording; its selector is a GUESS.
 */
import { isSelfDescribedBotName } from "../../core/handle/selfDescription";
import type { PartialSignals, PostRef } from "../../core/types";
import { YOUTUBE_ORIGIN } from "./conventions";
import type { VideoCreator } from "./handles";

export const COMMENT_SELECTOR = "ytd-comment-view-model";
export const AUTHOR_LINK_ID = "author-text";
const AUTHOR_LINK_SELECTOR = `#${AUTHOR_LINK_ID}`;
const REPLY_ATTRIBUTE = "is-reply";
/**
 * GUESS: the grey chip YouTube puts round the creator's name on the creator's own comment, a
 * `ytd-author-comment-badge-renderer` inside the header's `#author-comment-badge`, which is empty on
 * every recorded comment. Assumed to replace `#author-text` as the visible name, so the badge
 * anchors after the chip when it is there.
 */
const CREATOR_CHIP_SELECTOR = "#author-comment-badge ytd-author-comment-badge-renderer";
const OWNER_LINK_SELECTOR = "ytd-watch-metadata ytd-video-owner-renderer a[href^='/@']";
const OWNER_NAME_SELECTOR = "ytd-watch-metadata ytd-video-owner-renderer #channel-name a";
const HANDLE_PATH = /^\/@([^/?#]+)/;
/** YouTube handles: 3 to 30 letters, digits, marks, "_", "-" and ".", in any script. */
const HANDLE_PATTERN = /^[\p{L}\p{N}\p{M}_.-]{3,30}$/u;

export interface YouTubeCommentRef extends PostRef {
  kind: "comment";
  /** The comment carries the creator chip. */
  byCreator: boolean;
}

/**
 * What an element is, worked out once: not a comment, a comment whose author link has not been
 * filled in yet (Polymer binds the link after it stamps the element) or holds no readable handle,
 * or a comment to badge.
 */
export type YouTubeComment =
  | { status: "notComment" }
  | { status: "unreadableAuthor" }
  | { status: "comment"; post: YouTubeCommentRef };

/** The handle a `/@<handle>` link names, decoded and lowercased; undefined for any other link. */
export function handleOfLink(link: Element | null): string | undefined {
  let path: string;
  try {
    path = new URL(link?.getAttribute("href") ?? "", `${YOUTUBE_ORIGIN}/`).pathname;
  } catch {
    return undefined;
  }
  const encoded: string | undefined = HANDLE_PATH.exec(path)?.[1];
  if (encoded === undefined) return undefined;
  let handle: string;
  try {
    handle = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
  return HANDLE_PATTERN.test(handle) ? handle.toLowerCase() : undefined;
}

export function classify(element: Element): YouTubeComment {
  if (element.localName !== COMMENT_SELECTOR) return { status: "notComment" };
  const authorLink: Element | null = element.querySelector(AUTHOR_LINK_SELECTOR);
  const handle: string | undefined = handleOfLink(authorLink);
  if (authorLink === null || handle === undefined) return { status: "unreadableAuthor" };
  const chip: Element | null = element.querySelector(CREATOR_CHIP_SELECTOR);
  return {
    status: "comment",
    post: {
      element,
      ref: { platform: "youtube", handle },
      anchor: chip ?? authorLink,
      kind: "comment",
      isReply: element.hasAttribute(REPLY_ATTRIBUTE),
      byCreator: chip !== null,
    },
  };
}

/**
 * A comment shows its author's handle and nothing else about the account; a handle whose last word
 * is "bot" is a declaration. The avatar is not read: a `ytc/` path serves both the letter YouTube
 * draws for a channel without one and the Google account's photo (ADR-0030).
 */
export function extractDomSignals(post: PostRef): PartialSignals {
  const signals: PartialSignals = {};
  if (isSelfDescribedBotName(post.ref.handle)) {
    signals.declaredAutomated = true;
    signals.declaredBy = "name";
  }
  return signals;
}

/** The video's creator as the watch metadata names it, or undefined before it has rendered. */
export function readVideoCreator(
  doc: Document,
  chipHandles: Iterable<string> = [],
): VideoCreator | undefined {
  const ownerLink: Element | null = doc.querySelector(OWNER_LINK_SELECTOR);
  const handle: string | undefined = handleOfLink(ownerLink);
  if (ownerLink === null || handle === undefined) return undefined;
  const name: string = doc.querySelector(OWNER_NAME_SELECTOR)?.textContent?.trim() ?? "";
  return {
    handles: new Set([handle, ...chipHandles]),
    names: name === "" ? [handle] : [name, handle],
  };
}
