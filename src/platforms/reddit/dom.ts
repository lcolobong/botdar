/**
 * Tier 0 for Reddit: what the rendered feed says about a post's author, read without network
 * requests. New Reddit renders `shreddit-post` and `shreddit-comment` custom elements whose author is
 * an attribute and whose author link is slotted light DOM, so nothing here pierces a shadow root
 * except as a fallback. old.reddit renders `.thing[data-author]` with an `a.author` link.
 *
 * Every selector that was not confirmed against live markup is marked GUESS and kept here so a
 * day-one correction is a one-file change.
 */
import type { BadgeDensity, PartialSignals, PostRef } from "../../core/types";
import { isDefaultAvatarUrl, isPlausibleUsername } from "./conventions";

export type RedditPostKind = "post" | "comment";

export interface RedditPostRef extends PostRef {
  kind: RedditPostKind;
}

export const POST_SELECTOR = "shreddit-post";
export const COMMENT_SELECTOR = "shreddit-comment";
export const OLD_REDDIT_THING_SELECTOR = ".thing[data-author]";
export const FEED_ITEM_SELECTOR = `${POST_SELECTOR}, ${COMMENT_SELECTOR}, ${OLD_REDDIT_THING_SELECTOR}`;

const USER_LINK_SELECTOR = 'a[href^="/user/"]';
/** Slotted nodes are direct children of the host, so `:scope >` keeps a parent comment's query out of its replies. */
const SLOTTED_META_ROW_SELECTOR: Record<RedditPostKind, string> = {
  post: ':scope > [slot="credit-bar"]',
  comment: ':scope > [slot="commentMeta"]',
};
const OLD_REDDIT_META_ROW_SELECTOR = ":scope > .entry .tagline";
const OLD_REDDIT_AUTHOR_LINK_SELECTOR = "a.author";
/**
 * GUESS: the markup of Reddit's registered-app tag (rendered as "APP" beside the author) was not
 * captured before this shipped. The selectors cover the shapes Reddit uses for similar tags; the text
 * check catches a bare "APP" leaf in the author row whatever its wrapper is called.
 */
const APP_TAG_SELECTOR =
  '[data-testid="app-tag"], .app-tag, shreddit-tag[type="app"], faceplate-tracker[noun="app_tag"]';
const APP_TAG_TEXT = "APP";
/** GUESS: the author avatar is assumed to be the image inside the author's profile link. */
const AUTHOR_AVATAR_SELECTOR = `${USER_LINK_SELECTOR} img, ${USER_LINK_SELECTOR} faceplate-img`;
const MAX_DISPLAY_NAME_LENGTH = 100;

// MARK: - Element classification

function isOldRedditThing(element: Element): boolean {
  return element.matches(OLD_REDDIT_THING_SELECTOR);
}

export function kindOf(element: Element): RedditPostKind | undefined {
  const tag: string = element.tagName.toLowerCase();
  if (tag === POST_SELECTOR) return "post";
  if (tag === COMMENT_SELECTOR) return "comment";
  if (isOldRedditThing(element)) return element.classList.contains("comment") ? "comment" : "post";
  return undefined;
}

export function densityFor(kind: RedditPostKind): BadgeDensity {
  return kind === "comment" ? "reddit-comment" : "reddit-post";
}

/** The author's username with the casing Reddit renders; undefined for deleted or implausible names. */
export function authorNameOf(element: Element): string | undefined {
  const raw: string | null = element.getAttribute("author") ?? element.getAttribute("data-author");
  const name: string = raw?.trim() ?? "";
  return isPlausibleUsername(name) ? name : undefined;
}

// MARK: - Author row lookup

function metaRowsOf(element: Element, kind: RedditPostKind): ParentNode[] {
  const rows: ParentNode[] = [];
  const slottedSelector: string = isOldRedditThing(element)
    ? OLD_REDDIT_META_ROW_SELECTOR
    : SLOTTED_META_ROW_SELECTOR[kind];
  for (const row of element.querySelectorAll(slottedSelector)) rows.push(row);
  if (element.shadowRoot !== null) rows.push(element.shadowRoot);
  return rows;
}

function profilePathName(link: Element): string | undefined {
  const href: string = link.getAttribute("href") ?? "";
  return href.split("/")[2]?.toLowerCase();
}

/**
 * Slotted light DOM first, then the open shadow root. Among several profile links (crossposts,
 * mentions) the one that leads to the author wins; the first profile link is the fallback.
 */
export function findAuthorAnchor(element: Element, kind: RedditPostKind): Element | null {
  const author: string | undefined = authorNameOf(element)?.toLowerCase();
  const linkSelector: string = isOldRedditThing(element)
    ? OLD_REDDIT_AUTHOR_LINK_SELECTOR
    : USER_LINK_SELECTOR;
  for (const row of metaRowsOf(element, kind)) {
    const links: Element[] = [...row.querySelectorAll(linkSelector)];
    const toAuthor: Element | undefined = links.find((link) => profilePathName(link) === author);
    const anchor: Element | undefined = toAuthor ?? links[0];
    if (anchor !== undefined) return anchor;
  }
  return null;
}

function hasAppTag(element: Element, kind: RedditPostKind): boolean {
  return metaRowsOf(element, kind).some((row) => {
    if (row.querySelector(APP_TAG_SELECTOR) !== null) return true;
    return [...row.querySelectorAll("*")].some(
      (leaf) => leaf.childElementCount === 0 && leaf.textContent?.trim() === APP_TAG_TEXT,
    );
  });
}

/** true for a stock avatar, false for an uploaded one, undefined when no avatar image is rendered. */
function hasDefaultAvatar(element: Element, kind: RedditPostKind): boolean | undefined {
  for (const row of metaRowsOf(element, kind)) {
    const avatar: Element | null = row.querySelector(AUTHOR_AVATAR_SELECTOR);
    const source: string | null =
      avatar?.getAttribute("src") ?? avatar?.getAttribute("data-src") ?? null;
    if (source !== null) return isDefaultAvatarUrl(source);
  }
  return undefined;
}

function isReply(element: Element, kind: RedditPostKind): boolean {
  if (kind !== "comment") return false;
  const depth: number = Number(element.getAttribute("depth") ?? "0");
  if (depth > 0) return true;
  return element.parentElement?.closest(OLD_REDDIT_THING_SELECTOR) !== null;
}

// MARK: - Tier 0 contract

/** null when the element is not a post, has no usable author, or renders no author link to anchor on. */
export function toPostRef(element: Element): RedditPostRef | null {
  const kind: RedditPostKind | undefined = kindOf(element);
  const author: string | undefined = authorNameOf(element);
  if (kind === undefined || author === undefined) return null;
  const anchor: Element | null = findAuthorAnchor(element, kind);
  if (anchor === null) return null;
  const post: RedditPostRef = {
    element,
    ref: { platform: "reddit", handle: author.toLowerCase() },
    anchor,
    kind,
    isReply: isReply(element, kind),
  };
  if (hasAppTag(element, kind)) post.nativeLabel = "automated";
  return post;
}

/**
 * `shreddit-post[created-timestamp]` is the post's publication time, not the author's cake day, so it
 * never feeds `createdAt`: account age only arrives from Tier 2. The rendered username keeps its
 * casing, which the generated-name feature needs and the lowercased handle has lost.
 */
export function extractDomSignals(post: PostRef): PartialSignals {
  const kind: RedditPostKind | undefined = kindOf(post.element);
  const author: string | undefined = authorNameOf(post.element);
  if (kind === undefined || author === undefined) return {};
  const signals: PartialSignals = { displayName: author.slice(0, MAX_DISPLAY_NAME_LENGTH) };
  if (post.nativeLabel === "automated" || hasAppTag(post.element, kind)) {
    signals.declaredAutomated = true;
  }
  const avatar: boolean | undefined = hasDefaultAvatar(post.element, kind);
  if (avatar !== undefined) signals.hasDefaultAvatar = avatar;
  return signals;
}
