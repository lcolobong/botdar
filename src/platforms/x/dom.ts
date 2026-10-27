/**
 * Tier 0 for X: everything the rendered timeline shows about a post's author. Every X selector
 * lives here so a markup change is a one-file fix (docs/architecture.md, "X", Tier 0). X's class
 * names are hashed and rotate; only `data-testid` attributes, link hrefs and visible text are read.
 */
import type { PartialSignals, PostRef } from "@/src/core/types";

export const POST_SELECTOR = 'article[data-testid="tweet"]';
/** Marked by the wiring layer once a badge is mounted, so later passes skip the post at selector level. */
export const BADGED_ATTRIBUTE = "data-botdar";
export const UNBADGED_POST_SELECTOR = `${POST_SELECTOR}:not([${BADGED_ATTRIBUTE}])`;

const USER_NAME_SELECTOR = '[data-testid="User-Name"]';
const PROFILE_LINK_SELECTOR = 'a[href^="/"]';
const AVATAR_IMAGE_SELECTOR = '[data-testid="Tweet-User-Avatar"] img';
export const POST_TEXT_SELECTOR = '[data-testid="tweetText"]';
const DEFAULT_AVATAR_PATH_SEGMENT = "default_profile_images";
const HANDLE_TEXT_PATTERN = /^@([A-Za-z0-9_]{1,15})$/;
/**
 * The "Automated" label row and the "Replying to" row carry no test id; both are found by their
 * own span text outside the post body, which is where X renders them (day-one validation 8).
 */
const AUTOMATED_LABEL_TEXT = "automated";
const REPLYING_TO_TEXT = "replying to";
const MAX_DISPLAY_NAME_LENGTH = 100;

export function findUnbadgedPosts(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(UNBADGED_POST_SELECTOR));
}

export function markBadged(post: Element): void {
  post.setAttribute(BADGED_ATTRIBUTE, "1");
}

export function unmarkBadged(post: Element): void {
  post.removeAttribute(BADGED_ATTRIBUTE);
}

function ownText(element: Element): string {
  return element.textContent?.trim() ?? "";
}

function profileLinks(article: Element): HTMLAnchorElement[] {
  const userName: Element | null = article.querySelector(USER_NAME_SELECTOR);
  return userName === null
    ? []
    : Array.from(userName.querySelectorAll<HTMLAnchorElement>(PROFILE_LINK_SELECTOR));
}

function handleLinkOf(article: Element): { link: HTMLAnchorElement; handle: string } | undefined {
  for (const link of profileLinks(article)) {
    const handle: string | undefined = HANDLE_TEXT_PATTERN.exec(ownText(link))?.[1];
    if (handle !== undefined) {
      return { link, handle: handle.toLowerCase() };
    }
  }
  return undefined;
}

/** The post author's lowercased handle, read from the "@handle" link in the author row. */
export function authorHandleOf(article: Element): string | undefined {
  return handleLinkOf(article)?.handle;
}

/** Spans outside the post text whose own text is the wanted label, case-insensitively. */
function hasLabelSpan(article: Element, wanted: string): boolean {
  for (const span of article.querySelectorAll("span")) {
    if (span.closest(POST_TEXT_SELECTOR) !== null) {
      continue;
    }
    if (ownText(span).toLowerCase() === wanted) {
      return true;
    }
  }
  return false;
}

/** The post reference for an article, or undefined when the author row is missing. */
export function toPostRef(article: Element): PostRef | undefined {
  const found = handleLinkOf(article);
  if (found === undefined) {
    return undefined;
  }
  const post: PostRef = {
    element: article,
    ref: { platform: "x", handle: found.handle },
    anchor: found.link.parentElement ?? found.link,
  };
  if (hasLabelSpan(article, REPLYING_TO_TEXT)) {
    post.isReply = true;
  }
  if (hasLabelSpan(article, AUTOMATED_LABEL_TEXT)) {
    post.nativeLabel = "automated";
  }
  return post;
}

export function extractDomSignals(post: PostRef): PartialSignals {
  const signals: PartialSignals = {};
  const nameLink: HTMLAnchorElement | undefined = profileLinks(post.element).find(
    (link) => !ownText(link).startsWith("@"),
  );
  const displayName: string = nameLink === undefined ? "" : ownText(nameLink);
  if (displayName.length > 0) {
    signals.displayName = displayName.slice(0, MAX_DISPLAY_NAME_LENGTH);
  }
  const avatar: HTMLImageElement | null = post.element.querySelector(AVATAR_IMAGE_SELECTOR);
  if (avatar !== null) {
    signals.hasDefaultAvatar = avatar.src.includes(DEFAULT_AVATAR_PATH_SEGMENT);
  }
  // Absence of the label is left unobserved: only Tier 1's user object can say "not automated".
  if (post.nativeLabel === "automated") {
    signals.declaredAutomated = true;
  }
  return signals;
}
