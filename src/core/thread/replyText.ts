/**
 * Reading a reply from the page for the thread index (ADR-0027): its own words, and its time. Quoted
 * text is someone else's words: a reply that quotes another in full before answering it is not a
 * copy, so each platform names what it renders quotes as and that part is left out.
 */
import type { ThreadReply } from "./threadIndex";

/**
 * A reply whose markup has not finished rendering (Reddit slots a comment's body in after the
 * element): the caller reads the element again on a later pass. Every other failure to read a reply
 * is structural (the root, an ancestor, a post with no text, another page) and final.
 */
export const NOT_YET_READABLE = "notYetReadable";

/** What a platform's reader makes of one post element; undefined when it is not a reply. */
export type ReplyReading = ThreadReply | undefined | typeof NOT_YET_READABLE;

/**
 * A thread's root post, read only for the links it carries (ADR-0029): replies discussing a story
 * link its site, so the root's domains never count as shared.
 */
export interface ThreadRootLinks {
  threadKey: string;
  links: readonly string[];
}

const EXPLICIT_ZONE_PATTERN = /(?:Z|[+-]\d\d:?\d\d)$/i;
const COLONLESS_OFFSET_PATTERN = /([+-]\d\d)(\d\d)$/;

/**
 * An ISO 8601 time as a page renders it, with the zone ECMAScript's date format requires: none
 * means UTC, and a colon-less offset ("+0000", Reddit's form) gains its colon. Only V8's legacy
 * fallback parses "+0000"; an engine that follows the specification answers NaN.
 */
export function withExplicitZone(isoTime: string): string {
  if (!EXPLICIT_ZONE_PATTERN.test(isoTime)) {
    return `${isoTime}Z`;
  }
  return isoTime.replace(COLONLESS_OFFSET_PATTERN, "$1:$2");
}

/** Epoch milliseconds of a time the page renders, or undefined when it does not parse. */
export function pageTimestampMillis(isoTime: string): number | undefined {
  const millis: number = Date.parse(withExplicitZone(isoTime.trim()));
  return Number.isNaN(millis) ? undefined : millis;
}

const WEB_LINK_SELECTOR = 'a[href^="https://"], a[href^="http://"]';

/**
 * The absolute links in `root`, without those inside an element matching `excludedSelector` within
 * it. A relative link stays on the platform, whose own domains never count.
 */
export function webLinksIn(root: Element, excludedSelector?: string): string[] {
  const links: string[] = [];
  for (const anchor of root.querySelectorAll(WEB_LINK_SELECTOR)) {
    const excluded: Element | null =
      excludedSelector === undefined ? null : anchor.closest(excludedSelector);
    if (excluded === null || !root.contains(excluded)) {
      links.push(anchor.getAttribute("href") ?? "");
    }
  }
  return links;
}

/** The reply's links as `ThreadReply.links` spreads them: omitted when there are none. */
export function linksField(links: readonly string[]): { links?: readonly string[] } {
  return links.length === 0 ? {} : { links };
}

const TEXT_NODE_FILTER = 4; // NodeFilter.SHOW_TEXT, spelled out so the module loads without a DOM.

/**
 * The text of `root` without whatever sits inside an element matching `excludedSelector` within it.
 * Text nodes are joined with spaces so words in adjacent blocks never run together; the reply
 * normaliser collapses the extra spaces.
 */
export function textOutside(root: Element, excludedSelector: string): string {
  const parts: string[] = [];
  const walker: TreeWalker = root.ownerDocument.createTreeWalker(root, TEXT_NODE_FILTER);
  for (let node: Node | null = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const excluded: Element | null | undefined = node.parentElement?.closest(excludedSelector);
    if (excluded === null || excluded === undefined || !root.contains(excluded)) {
      parts.push(node.textContent ?? "");
    }
  }
  return parts.join(" ");
}
