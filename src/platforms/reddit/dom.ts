/**
 * Tier 0 for Reddit: what the rendered feed says about a post's author, read without network
 * requests. New Reddit renders `shreddit-post` and `shreddit-comment` custom elements whose author is
 * an attribute and whose author link is slotted light DOM, so nothing here pierces a shadow root
 * except as a fallback. old.reddit renders `.thing[data-author]` with an `a.author` link.
 *
 * Every selector that was not confirmed against live markup is marked GUESS and kept here so a
 * day-one correction is a one-file change.
 */
import { flairDeclaresAutomation, isSelfDescribedBotName } from "../../core/handle/selfDescription";
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

/**
 * Reddit writes the author link relative (`/user/<name>/`) in some surfaces and absolute
 * (`https://www.reddit.com/user/<name>/`) in others, including the post page since late 2026; the
 * selector only narrows the candidates and `profilePathName` decides what is a profile link.
 */
const USER_LINK_SELECTOR = 'a[href*="/user/"], a[href*="/u/"]';
/**
 * The slotted rows that carry the author link and avatar. On the post page a comment's rows sit
 * inside `details > summary`, not as direct children of the comment, so a `:scope >` query misses
 * them; `metaRowsOf` instead keeps the rows whose nearest feed item is the element, which also keeps
 * a parent comment's query out of its replies. The selectors are queried one at a time, in order:
 * the avatar slot precedes the meta row in the markup, and the badge must anchor beside the name.
 */
const SLOTTED_META_ROW_SELECTORS: Record<RedditPostKind, readonly string[]> = {
  post: ['[slot="credit-bar"]'],
  comment: ['[slot="commentMeta"]', '[slot="commentAvatar"]'],
};
const OLD_REDDIT_META_ROW_SELECTORS: readonly string[] = [":scope > .entry .tagline"];
const REDDIT_ORIGIN = "https://www.reddit.com";
const OLD_REDDIT_AUTHOR_LINK_SELECTOR = "a.author";
/**
 * Reddit's registered-app tag, recorded from a live feed on 2026-10-25: a pill whose classes are
 * `bg-tags-app-background text-tags-app-content`, holding a shield icon and the word "App". The
 * earlier guesses stay as fallbacks, and the text check catches the leaf whatever its wrapper is
 * called; it compares case-insensitively because the live text is "App", not "APP".
 */
const APP_TAG_SELECTOR =
  '[class*="tags-app"], [data-testid="app-tag"], .app-tag, shreddit-tag[type="app"], faceplate-tracker[noun="app_tag"]';
const APP_TAG_TEXT = "app";
/** GUESS: the author avatar is assumed to be the image inside one of the author's profile links. */
const AVATAR_IMAGE_SELECTOR = "img, faceplate-img";
/**
 * Author flair. On a live feed (recorded 2026-10-25) a post's credit bar carries the flair in a
 * `.credit-bar-user-flair` button whose text sits in `[data-credit-bar-flair-content]`; those two
 * come first. The rest are GUESSes for comment rows, which no recording has shown with flair yet.
 * A subreddit that flairs its bots ("Verified GPT-2 Bot") is the account's community describing
 * it, which the engine treats as a declaration.
 */
const AUTHOR_FLAIR_SELECTOR =
  '[data-credit-bar-flair-content], .credit-bar-user-flair, shreddit-comment-author-flair, shreddit-author-flair, [slot="authorFlair"], [class*="flair" i], [data-testid*="flair" i]';
/**
 * Home-feed cards (view-context AggregateFeed, recorded 2026-10-25) show the community and the
 * post time but never an author link, although the author still arrives in the `author`
 * attribute. The badge then anchors after the time, where the card's metadata ends; the hover
 * card names the account, so the reader is not left guessing what the badge is about.
 */
const POST_TIME_SELECTOR = "time, faceplate-timeago";
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
  const selectors: readonly string[] = isOldRedditThing(element)
    ? OLD_REDDIT_META_ROW_SELECTORS
    : SLOTTED_META_ROW_SELECTORS[kind];
  for (const selector of selectors) {
    for (const row of element.querySelectorAll(selector)) {
      if (row.closest(FEED_ITEM_SELECTOR) === element) rows.push(row);
    }
  }
  if (element.shadowRoot !== null) rows.push(element.shadowRoot);
  return rows;
}

/** The lowercased username a profile link leads to, relative or absolute; undefined for any other link. */
function profilePathName(link: Element): string | undefined {
  const href: string = link.getAttribute("href") ?? "";
  let url: URL;
  try {
    url = new URL(href, REDDIT_ORIGIN);
  } catch {
    return undefined;
  }
  if (url.hostname !== "reddit.com" && !url.hostname.endsWith(".reddit.com")) return undefined;
  const [, root, name] = url.pathname.split("/");
  if ((root !== "user" && root !== "u") || name === undefined || name === "") return undefined;
  return name.toLowerCase();
}

/**
 * Slotted light DOM first, then the open shadow root. Among several profile links (crossposts,
 * mentions) the one that leads to the author wins; the first profile link is the fallback.
 */
export function findAuthorAnchor(
  element: Element,
  kind: RedditPostKind,
  rows: readonly ParentNode[] = metaRowsOf(element, kind),
): Element | null {
  const author: string | undefined = authorNameOf(element)?.toLowerCase();
  const linkSelector: string = isOldRedditThing(element)
    ? OLD_REDDIT_AUTHOR_LINK_SELECTOR
    : USER_LINK_SELECTOR;
  for (const row of rows) {
    const links: Element[] = [...row.querySelectorAll(linkSelector)].filter(
      (link) => isOldRedditThing(element) || profilePathName(link) !== undefined,
    );
    const toAuthor: Element | undefined = links.find((link) => profilePathName(link) === author);
    const anchor: Element | undefined = toAuthor ?? links[0];
    if (anchor !== undefined) return anchor;
  }
  return postTimeAnchor(element, kind);
}

/** The home feed's stand-in for an author link; comments and old Reddit always render one. */
function postTimeAnchor(element: Element, kind: RedditPostKind): Element | null {
  if (kind !== "post" || isOldRedditThing(element)) return null;
  for (const row of metaRowsOf(element, kind)) {
    const time: Element | null = row.querySelector(POST_TIME_SELECTOR);
    if (time !== null) return time;
  }
  return null;
}

function hasAppTagLeaf(row: ParentNode): boolean {
  for (const leaf of row.querySelectorAll("*")) {
    if (leaf.childElementCount === 0 && leaf.textContent?.trim().toLowerCase() === APP_TAG_TEXT) {
      return true;
    }
  }
  return false;
}

/**
 * Each row's text is read once, natively, before any leaf is visited: almost no row contains "APP"
 * at all, and walking every leaf of a whole shadow root was the costliest part of Tier 0.
 */
function hasAppTag(rows: readonly ParentNode[]): boolean {
  return rows.some((row) => {
    if (row.querySelector(APP_TAG_SELECTOR) !== null) return true;
    if (!(row.textContent ?? "").toLowerCase().includes(APP_TAG_TEXT)) return false;
    return hasAppTagLeaf(row);
  });
}

/** true for a stock avatar, false for an uploaded one, undefined when no avatar image is rendered. */
function hasDefaultAvatar(element: Element, rows: readonly ParentNode[]): boolean | undefined {
  const author: string | undefined = authorNameOf(element)?.toLowerCase();
  for (const row of rows) {
    // The avatar and the name are often separate links to the same profile; the community icon
    // sits in a link to the subreddit and must not be mistaken for it.
    const authorLinks: Element[] = [...row.querySelectorAll(USER_LINK_SELECTOR)].filter(
      (link) => profilePathName(link) === author,
    );
    for (const link of authorLinks) {
      const avatar: Element | null = link.querySelector(AVATAR_IMAGE_SELECTOR);
      const source: string | null =
        avatar?.getAttribute("src") ?? avatar?.getAttribute("data-src") ?? null;
      if (source !== null) return isDefaultAvatarUrl(source);
    }
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
  const rows: ParentNode[] = metaRowsOf(element, kind);
  const anchor: Element | null = findAuthorAnchor(element, kind, rows);
  if (anchor === null) return null;
  const post: RedditPostRef = {
    element,
    ref: { platform: "reddit", handle: author.toLowerCase() },
    anchor,
    kind,
    isReply: isReply(element, kind),
  };
  if (hasAppTag(rows)) post.nativeLabel = "automated";
  return post;
}

/**
 * `shreddit-post[created-timestamp]` is the post's publication time, not the author's cake day, so it
 * never feeds `createdAt`: account age only arrives from Tier 2. The rendered username keeps its
 * casing, which the generated-name feature needs and the lowercased handle has lost. The APP tag is
 * read once, by `toPostRef`, and arrives here as `nativeLabel` rather than being searched for again.
 */
function authorFlairText(rows: readonly ParentNode[]): string | undefined {
  for (const row of rows) {
    const text: string | undefined = row.querySelector(AUTHOR_FLAIR_SELECTOR)?.textContent?.trim();
    if (text !== undefined && text.length > 0) return text;
  }
  return undefined;
}

export function extractDomSignals(post: PostRef): PartialSignals {
  const kind: RedditPostKind | undefined = kindOf(post.element);
  const author: string | undefined = authorNameOf(post.element);
  if (kind === undefined || author === undefined) return {};
  const signals: PartialSignals = { displayName: author.slice(0, MAX_DISPLAY_NAME_LENGTH) };
  const rows: ParentNode[] = metaRowsOf(post.element, kind);
  const flair: string | undefined = authorFlairText(rows);
  if (post.nativeLabel === "automated") {
    signals.declaredAutomated = true;
    signals.declaredBy = "label";
  } else if (isSelfDescribedBotName(author)) {
    signals.declaredAutomated = true;
    signals.declaredBy = "name";
  } else if (flair !== undefined && flairDeclaresAutomation(flair)) {
    signals.declaredAutomated = true;
    signals.declaredBy = "flair";
  }
  const avatar: boolean | undefined = hasDefaultAvatar(post.element, rows);
  if (avatar !== undefined) signals.hasDefaultAvatar = avatar;
  return signals;
}
