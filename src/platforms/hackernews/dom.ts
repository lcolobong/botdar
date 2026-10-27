/**
 * Tier 0 for Hacker News: what the server-rendered page says about an item's author. Every page is
 * a table of `tr.athing` rows, recorded on 2026-10-27 (tests/fixtures/hackernews/html/):
 *
 * - a story (`tr.athing.submission` on the front page, /newest and a thread's head) keeps its
 *   author in the next row's `.subline`;
 * - a comment (`tr.athing.comtr` in a thread, a plain `tr.athing` with a `.comment` body on
 *   /newcomments) keeps its author in its own `.comhead`;
 * - the user page renders the profile in a `tr.athing` too, with the name in a `td[timestamp]`
 *   and no comment body, so the account being viewed is never a post and gets no badge.
 *
 * Usernames are case-sensitive on Hacker News (Firebase answers `null` for the wrong case), so the
 * handle keeps the casing of the `user?id=` link instead of being lowercased.
 */
import { isSelfDescribedBotName } from "../../core/handle/selfDescription";
import type { PartialSignals, PostRef } from "../../core/types";

export type HackerNewsPostKind = "post" | "comment";

export interface HackerNewsPostRef extends PostRef {
  kind: HackerNewsPostKind;
  /** The item a comment answers, when its row links one (`parentItemIdOf`). */
  parentId?: string;
}

export const FEED_ITEM_SELECTOR = "tr.athing";
const STORY_ROW_CLASS = "submission";
/** The row under a story's title row: score, author, age and the comment count. */
const STORY_META_SELECTOR = ".subtext";
const STORY_AUTHOR_SELECTOR = ".subtext a.hnuser";
/** A story's title row has a `.comhead` too (the site name), but never an author link inside it. */
const COMMENT_AUTHOR_SELECTOR = ".comhead a.hnuser";
/** A thread marks comment rows `comtr`; /newcomments does not, but every comment has a body. */
const COMMENT_ROW_CLASS = "comtr";
const COMMENT_BODY_SELECTOR = ".comment";
const INDENT_SELECTOR = "td.ind[indent]";
const NAV_LINK_SELECTOR = ".navs a";
const PARENT_LINK_TEXT = "parent";
const STORY_LINK_SELECTOR = ".onstory a";
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,15}$/;
const PROFILE_PATH = "/user";
const HACKER_NEWS_ORIGIN = "https://news.ycombinator.com";

// MARK: - Element classification

/**
 * What a row is, worked out once: not a post at all (the user page's profile row), a story or
 * comment with no author link (a job ad, a deleted comment), a story or comment whose author link
 * holds no readable username (an anchor miss), or a post to badge.
 */
export type HackerNewsRow =
  | { status: "notPost" }
  | { status: "noAuthor"; kind: HackerNewsPostKind }
  | { status: "unreadableAuthor"; kind: HackerNewsPostKind }
  | { status: "post"; post: HackerNewsPostRef };

function storyMetaRowOf(row: Element): Element | null {
  const next: Element | null = row.nextElementSibling;
  return next?.querySelector(STORY_META_SELECTOR) === null ? null : next;
}

function kindOf(row: Element): HackerNewsPostKind | undefined {
  if (!row.matches(FEED_ITEM_SELECTOR)) return undefined;
  if (
    row.classList.contains(COMMENT_ROW_CLASS) ||
    row.querySelector(COMMENT_BODY_SELECTOR) !== null
  ) {
    return "comment";
  }
  if (row.classList.contains(STORY_ROW_CLASS) || storyMetaRowOf(row) !== null) return "post";
  return undefined;
}

/** The author link a badge anchors after; null for a job ad or a deleted comment. */
function findAuthorLink(row: Element, kind: HackerNewsPostKind): Element | null {
  if (kind === "comment") return row.querySelector(COMMENT_AUTHOR_SELECTOR);
  return storyMetaRowOf(row)?.querySelector(STORY_AUTHOR_SELECTOR) ?? null;
}

/** The `id` of a `user?id=<name>` link, with the casing Hacker News stores. */
function usernameOfLink(link: Element): string | undefined {
  let url: URL;
  try {
    url = new URL(link.getAttribute("href") ?? "", `${HACKER_NEWS_ORIGIN}/`);
  } catch {
    return undefined;
  }
  if (url.pathname !== PROFILE_PATH) return undefined;
  const name: string = url.searchParams.get("id") ?? link.textContent?.trim() ?? "";
  return USERNAME_PATTERN.test(name) ? name : undefined;
}

function itemIdOf(link: Element | null): string | undefined {
  return /[?&]id=(\d+)/.exec(link?.getAttribute("href") ?? "")?.[1];
}

/**
 * The item a comment answers, from its "parent" link: an in-page anchor (`#<id>`) in a thread, an
 * `item?id=<id>` link on /newcomments. Undefined for a top-level comment in a thread, which has none.
 */
export function parentItemIdOf(row: Element): string | undefined {
  const parentLink: Element | undefined = [...row.querySelectorAll(NAV_LINK_SELECTOR)].find(
    (link) => link.textContent?.trim() === PARENT_LINK_TEXT,
  );
  const href: string = parentLink?.getAttribute("href") ?? "";
  return /^#(\d+)$/.exec(href)?.[1] ?? itemIdOf(parentLink ?? null);
}

/**
 * A thread gives each comment its depth in `td.ind[indent]`. /newcomments leaves `td.ind` empty,
 * but every row there links its parent and its story, and a reply's parent is another comment.
 */
function isReply(row: Element, kind: HackerNewsPostKind, parent: string | undefined): boolean {
  if (kind !== "comment") return false;
  const indent: string | null | undefined = row
    .querySelector(INDENT_SELECTOR)
    ?.getAttribute("indent");
  if (indent !== null && indent !== undefined) return Number(indent) > 0;
  const story: string | undefined = itemIdOf(row.querySelector(STORY_LINK_SELECTOR));
  return parent !== undefined && parent !== story;
}

// MARK: - Tier 0 contract

export function classify(row: Element): HackerNewsRow {
  const kind: HackerNewsPostKind | undefined = kindOf(row);
  if (kind === undefined) return { status: "notPost" };
  const anchor: Element | null = findAuthorLink(row, kind);
  if (anchor === null) return { status: "noAuthor", kind };
  const author: string | undefined = usernameOfLink(anchor);
  if (author === undefined) return { status: "unreadableAuthor", kind };
  const parentId: string | undefined = kind === "comment" ? parentItemIdOf(row) : undefined;
  return {
    status: "post",
    post: {
      element: row,
      ref: { platform: "hackernews", handle: author },
      anchor,
      kind,
      isReply: isReply(row, kind, parentId),
      ...(parentId === undefined ? {} : { parentId }),
    },
  };
}

/** null when the row is not a story or comment, or has no usable author link to anchor on. */
export function toPostRef(row: Element): HackerNewsPostRef | null {
  const classified: HackerNewsRow = classify(row);
  return classified.status === "post" ? classified.post : null;
}

/**
 * The page shows nothing about an account but its name: no avatar, no join date, no counts. The
 * green name Hacker News gives new accounts is not read here because no recording has shown one
 * yet; `[dead]` and `[flagged]` are moderation outcomes, not evidence about the account, and are
 * not read either.
 */
export function extractDomSignals(post: PostRef): PartialSignals {
  const author: string = post.ref.handle;
  const signals: PartialSignals = { displayName: author };
  if (isSelfDescribedBotName(author)) {
    signals.declaredAutomated = true;
    signals.declaredBy = "name";
  }
  return signals;
}
