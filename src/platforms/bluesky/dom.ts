/**
 * Tier 0 for Bluesky: what the React-rendered feed shows about a post's author. Every selector here
 * is a guess recorded from the bsky.app markup on 2026-10-22 and isolated in this module so a
 * markup change is a one-file fix. The fixture at tests/fixtures/bluesky/html/feed.html mirrors
 * the assumed structure.
 */
import type { PartialSignals, PostRef } from "../../core/types";

/** Set on a post container once a badge was attached; the observer skips marked posts. */
export const BOTDAR_MARK_ATTRIBUTE = "data-botdar";

/**
 * Guess: feed rows and thread rows carry a test id whose suffix is the author's handle
 * (`feedItem-by-alice.example.com`, `postThreadItem-by-alice.example.com`).
 */
const POST_TEST_ID_PREFIXES: readonly string[] = ["feedItem-by-", "postThreadItem-by-"];

export const POST_SELECTOR: string = POST_TEST_ID_PREFIXES.map(
  (prefix) => `div[data-testid^="${prefix}"]`,
).join(", ");

export const UNMARKED_POST_SELECTOR: string = POST_TEST_ID_PREFIXES.map(
  (prefix) => `div[data-testid^="${prefix}"]:not([${BOTDAR_MARK_ATTRIBUTE}])`,
).join(", ");

/** Guess: every link to an account is `/profile/<handle>`; the avatar, name and handle share it. */
const PROFILE_LINK_SELECTOR = 'a[href^="/profile/"]';
const PROFILE_PATH_PREFIX = "/profile/";

/** Guess: the avatar component's test ids; a missing avatar renders the fallback instead of an img. */
const AVATAR_IMAGE_SELECTOR = '[data-testid="userAvatarImage"]';
const AVATAR_FALLBACK_SELECTOR = '[data-testid="userAvatarFallback"]';

/** Guess: Bluesky's own robot badge next to a declared bot's name. */
const DECLARED_BOT_BADGE_SELECTOR = '[data-testid="botBadge"], [aria-label="Bot account"]';

/** Handles are domain names; anything else in the test id suffix is not a post we can attribute. */
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const MAX_HANDLE_LENGTH = 253;
const MAX_DISPLAY_NAME_LENGTH = 100;

// MARK: - Author lookup

export function authorHandleOf(post: Element): string | undefined {
  const testId: string = post.getAttribute("data-testid") ?? "";
  const prefix: string | undefined = POST_TEST_ID_PREFIXES.find((candidate) =>
    testId.startsWith(candidate),
  );
  if (prefix === undefined) {
    return undefined;
  }
  const handle: string = testId.slice(prefix.length).trim().toLowerCase();
  return handle.length <= MAX_HANDLE_LENGTH && HANDLE_PATTERN.test(handle) ? handle : undefined;
}

function profilePathOf(link: Element): string {
  const href: string = link.getAttribute("href") ?? "";
  return href.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
}

function linksToAuthor(link: Element, handle: string): boolean {
  return profilePathOf(link) === `${PROFILE_PATH_PREFIX}${handle}`;
}

/** Profile links in document order that point at the post's author, not a reposter or quoted author. */
function authorLinks(post: Element, handle: string): Element[] {
  return [...post.querySelectorAll(PROFILE_LINK_SELECTOR)].filter((link) =>
    linksToAuthor(link, handle),
  );
}

/** An element belongs to the author's row when the nearest profile link around it is the author's. */
function belongsToAuthor(element: Element, handle: string): boolean {
  const enclosingLink: Element | null = element.closest(PROFILE_LINK_SELECTOR);
  return enclosingLink === null || linksToAuthor(enclosingLink, handle);
}

function normalizedText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The element showing `@handle`: the author link itself when that is its whole text, else the
 * innermost descendant that carries it. The badge mounts after this element.
 */
function findHandleElement(post: Element, handle: string): Element | undefined {
  const handleText: string = `@${handle}`;
  for (const link of authorLinks(post, handle)) {
    if (normalizedText(link).toLowerCase() === handleText) {
      return link;
    }
    const descendants: Element[] = [...link.querySelectorAll("*")].filter(
      (descendant) => normalizedText(descendant).toLowerCase() === handleText,
    );
    const innermost: Element | undefined = descendants.at(-1);
    if (innermost !== undefined) {
      return innermost;
    }
  }
  return undefined;
}

export function toPostRef(post: Element): PostRef | undefined {
  const handle: string | undefined = authorHandleOf(post);
  if (handle === undefined) {
    return undefined;
  }
  const anchor: Element | undefined =
    findHandleElement(post, handle) ?? authorLinks(post, handle)[0];
  if (anchor === undefined) {
    return undefined;
  }
  return { element: post, ref: { platform: "bluesky", handle }, anchor };
}

// MARK: - Tier 0 signals

function displayNameOf(post: Element, handle: string): string | undefined {
  const handlePattern = new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
  for (const link of authorLinks(post, handle)) {
    if (link.querySelector("img") !== null) {
      continue;
    }
    const name: string = normalizedText(link).replace(handlePattern, "").trim();
    if (name.length > 0) {
      return name.slice(0, MAX_DISPLAY_NAME_LENGTH);
    }
  }
  return undefined;
}

/** True for the fallback avatar, false for an image, undefined when neither is in the author's row. */
function hasDefaultAvatarOf(post: Element, handle: string): boolean | undefined {
  const avatar: Element | null = post.querySelector(
    `${AVATAR_IMAGE_SELECTOR}, ${AVATAR_FALLBACK_SELECTOR}`,
  );
  if (avatar === null || !belongsToAuthor(avatar, handle)) {
    return undefined;
  }
  return avatar.matches(AVATAR_FALLBACK_SELECTOR);
}

/** Only a visible robot badge is an observation; its absence says nothing because the selector is a guess. */
function declaredAutomatedOf(post: Element, handle: string): true | undefined {
  const badge: Element | null = post.querySelector(DECLARED_BOT_BADGE_SELECTOR);
  if (badge === null || !belongsToAuthor(badge, handle) || (badge as HTMLElement).hidden) {
    return undefined;
  }
  return true;
}

export function extractDomSignals(post: PostRef): PartialSignals {
  const signals: PartialSignals = {};
  const handle: string = post.ref.handle;
  const displayName: string | undefined = displayNameOf(post.element, handle);
  if (displayName !== undefined) {
    signals.displayName = displayName;
  }
  const hasDefaultAvatar: boolean | undefined = hasDefaultAvatarOf(post.element, handle);
  if (hasDefaultAvatar !== undefined) {
    signals.hasDefaultAvatar = hasDefaultAvatar;
  }
  if (declaredAutomatedOf(post.element, handle) === true) {
    signals.declaredAutomated = true;
  }
  return signals;
}
