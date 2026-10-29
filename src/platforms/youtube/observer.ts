/**
 * Comment discovery for YouTube (docs/architecture.md, "YouTube"). YouTube is a single-page app:
 * comments arrive as the reader scrolls (continuations), reply threads expand in place, and moving
 * to another video keeps the document. A MutationObserver finds the comments added under the comment
 * section (`ytd-comments`); as on Hacker News a comment is analysed only once it comes near the
 * viewport (src/core/nearViewport.ts), in budgeted slices (src/core/idleSlices.ts), so a long comment
 * section never blocks the player.
 *
 * Polymer recycles comment elements: re-sorting (Top to Newest) re-binds an element's author link in
 * place, and a removed element can come back stamped for another comment. So nothing is cached per
 * element but the handle a badge was reported with; every discovery reads the author again, a
 * change of `href` on an author link sends its comment round again, and a comment whose author
 * changed is reported removed and then reported anew.
 *
 * Navigation is the `yt-navigate-finish` event the app dispatches on the document, which the
 * isolated world hears too, with a check on every pass as the fallback. It compares the page, not the
 * whole address, so a timestamp or a playlist position on the same video changes nothing. On
 * navigation every badged comment is reported removed and the document is scanned again.
 */
import { UNBADGED } from "../../core/botdarMarks";
import type { ShouldYield, SliceScheduler } from "../../core/idleSlices";
import { IDLE_TIMEOUT_MS, createSliceScheduler, drainQueue } from "../../core/idleSlices";
import type { NearViewportGate } from "../../core/nearViewport";
import { createNearViewportGate } from "../../core/nearViewport";
import { recordAnchorMiss, recordSeen } from "../../core/diagnostics.ts";
import type { YouTubeComment, YouTubeCommentRef } from "./dom";
import { AUTHOR_LINK_ID, COMMENT_SELECTOR, classify } from "./dom";

export interface YouTubeCommentObserverOptions {
  onPost: (post: YouTubeCommentRef) => void;
  onRemoved: (element: Element) => void;
  /**
   * Every comment a discovery pass finds, near the viewport or not (the thread index, ADR-0027),
   * with the classification the badge will use when it is final.
   */
  onDiscovered?: (element: Element, classified: YouTubeComment) => void;
  /** Before each discovery pass: the page around the comments (its creator, its description). */
  onPass?: () => void;
  /** The app moved to another page; called before the new page is scanned. */
  onNavigated?: () => void;
}

/** The app's own event when it has moved to another page. */
export const NAVIGATE_FINISH_EVENT = "yt-navigate-finish";
/** `BADGED_ATTRIBUTE` marks a comment whose badge mounted; the wiring sets it so a reinjected script skips it. */
export const UNDISCOVERED_SELECTOR = `${COMMENT_SELECTOR}${UNBADGED}`;
/** The comment section; nodes added anywhere else (the player, tooltips) are never scanned. */
const COMMENT_SECTION_SELECTOR = "ytd-comments";
const WATCH_PATH = "/watch";
const VIDEO_PARAMETER = "v";

/** Which page an address shows: its path, and on a watch page the video, never `t=` or a playlist. */
export function pageKeyOf(url: URL): string {
  return url.pathname === WATCH_PATH
    ? `${url.pathname}?${VIDEO_PARAMETER}=${url.searchParams.get(VIDEO_PARAMETER) ?? ""}`
    : url.pathname;
}

const currentPageKey = (): string => pageKeyOf(new URL(location.href));

function* commentsWithin(subtree: Element): Generator<Element> {
  if (subtree.localName === COMMENT_SELECTOR) yield subtree;
  yield* subtree.querySelectorAll(COMMENT_SELECTOR);
}

export function observeYouTubeComments(options: YouTubeCommentObserverOptions): () => void {
  /** The comments whose badge was reported, with the handle it was reported for. */
  let reported = new Map<Element, string>();
  /** Near the viewport but not analysed yet, in the order they came near. */
  const queue = new Set<Element>();
  /** Subtrees to scan on the next pass, each once however many mutations named it. */
  let pendingSubtrees = new Set<Element>([document.documentElement]);
  let lastPageKey: string = currentPageKey();
  let stopped = false;

  const report = (element: Element): void => {
    if (reported.has(element) || !element.isConnected) return;
    const classified: YouTubeComment = classify(element);
    if (classified.status === "unreadableAuthor") recordAnchorMiss("comment", element);
    if (classified.status !== "comment") return;
    recordSeen("comment", element);
    reported.set(element, classified.post.ref.handle);
    options.onPost(classified.post);
  };

  const forgetComment = (element: Element): void => {
    gate.unwatch(element);
    queue.delete(element);
    if (reported.delete(element)) options.onRemoved(element);
  };

  const forget = (subtree: Element): void => {
    for (const element of commentsWithin(subtree)) forgetComment(element);
  };

  /** Reads the comment's author afresh; a recycled element is forgotten and watched as new. */
  const rediscover = (element: Element): void => {
    const classified: YouTubeComment = classify(element);
    // Every comment goes to the thread index, badged or not: a reinjected script starts with an
    // empty index while the badge marks survive.
    options.onDiscovered?.(element, classified);
    const reportedHandle: string | undefined = reported.get(element);
    if (reportedHandle !== undefined) {
      if (classified.status === "comment" && classified.post.ref.handle === reportedHandle) return;
      forgetComment(element);
    }
    if (element.matches(UNDISCOVERED_SELECTOR)) gate.watch(element);
  };

  const navigated = (): void => {
    lastPageKey = currentPageKey();
    for (const element of reported.keys()) options.onRemoved(element);
    for (const element of queue) gate.unwatch(element);
    reported = new Map<Element, string>();
    queue.clear();
    options.onNavigated?.();
    pendingSubtrees = new Set<Element>([document.documentElement]);
  };

  const discover = (): void => {
    if (currentPageKey() !== lastPageKey) navigated();
    options.onPass?.();
    const subtrees: Set<Element> = pendingSubtrees;
    pendingSubtrees = new Set<Element>();
    for (const subtree of subtrees) {
      if (!subtree.isConnected) continue;
      for (const element of commentsWithin(subtree)) rediscover(element);
    }
  };

  const runSlice = (shouldYield: ShouldYield): boolean => {
    if (stopped) return false;
    discover();
    return drainQueue(queue, report, shouldYield);
  };

  const scheduler: SliceScheduler = createSliceScheduler(window, IDLE_TIMEOUT_MS, runSlice);
  const gate: NearViewportGate = createNearViewportGate(window, (element) => {
    queue.add(element);
    scheduler.schedule();
  });

  /** The subtree an added node or a re-bound author link sends round, or null outside the comments. */
  const subtreeToRead = (node: Element): Element | null =>
    node.closest(COMMENT_SECTION_SELECTOR) === null
      ? null
      : (node.closest(COMMENT_SELECTOR) ?? node);

  const observer = new MutationObserver((records: MutationRecord[]): void => {
    let relevant = false;
    for (const record of records) {
      if (record.type === "attributes") {
        const target: Node = record.target;
        const comment: Element | null =
          target instanceof Element && target.id === AUTHOR_LINK_ID ? subtreeToRead(target) : null;
        if (comment !== null) {
          pendingSubtrees.add(comment);
          relevant = true;
        }
        continue;
      }
      for (const node of record.removedNodes) {
        if (node instanceof Element) forget(node);
      }
      for (const node of record.addedNodes) {
        // A comment's own markup stamped in later (its author's name) sends the comment round
        // again, so one whose author was not readable yet is discovered once it is.
        const subtree: Element | null = node instanceof Element ? subtreeToRead(node) : null;
        if (subtree !== null) {
          pendingSubtrees.add(subtree);
          relevant = true;
        }
      }
    }
    if (relevant) scheduler.schedule();
  });
  const onNavigateFinish = (): void => {
    if (currentPageKey() !== lastPageKey) navigated();
    scheduler.schedule();
  };
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  document.addEventListener(NAVIGATE_FINISH_EVENT, onNavigateFinish);
  scheduler.schedule();

  return (): void => {
    stopped = true;
    observer.disconnect();
    document.removeEventListener(NAVIGATE_FINISH_EVENT, onNavigateFinish);
    scheduler.dispose();
    gate.disconnect();
  };
}
