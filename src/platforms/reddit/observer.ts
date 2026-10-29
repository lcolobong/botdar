/**
 * Feed discovery for Reddit (docs/architecture.md, "Reddit"). One MutationObserver on the document
 * is enough: new posts and comments arrive in light DOM (`shreddit-feed`, `shreddit-comment-tree`,
 * `faceplate-partial`), and a mutation inside a shadow root never adds a post. Passes are coalesced
 * through requestIdleCallback so a burst of feed chunks costs one scan. A discovered post is only
 * analysed once it comes near the viewport (src/core/nearViewport.ts), and that analysis runs in
 * budgeted slices (src/core/idleSlices.ts) so a long thread never blocks.
 *
 * Reddit's SPA navigation uses pushState, which the isolated world cannot hook, so every pass
 * compares the location to the last one seen and `popstate` covers the back button.
 */
import { UNBADGED } from "../../core/botdarMarks";
import type { ShouldYield, SliceScheduler } from "../../core/idleSlices";
import { IDLE_TIMEOUT_MS, createSliceScheduler, drainQueue } from "../../core/idleSlices";
import type { NearViewportGate } from "../../core/nearViewport";
import { createNearViewportGate } from "../../core/nearViewport";
import type { RedditPostRef } from "./dom";
import { recordAnchorMiss, recordSeen } from "../../core/diagnostics.ts";
import { FEED_ITEM_SELECTOR, authorNameOf, kindOf, toPostRef } from "./dom";

export interface RedditFeedObserverOptions {
  onPost: (post: RedditPostRef) => void;
  onRemoved: (element: Element) => void;
  /** The page navigated in place; per-page UI state can reset while account caches survive. */
  onRouteChange?: (href: string) => void;
  /** Every item found by a discovery pass, near the viewport or not (the thread index, ADR-0027). */
  onDiscovered?: (element: Element) => void;
}

export { IDLE_TIMEOUT_MS };

/** `BADGED_ATTRIBUTE` marks a post whose badge mounted; the wiring sets it so a reinjected script skips it. */
export const UNDISCOVERED_SELECTOR: string = FEED_ITEM_SELECTOR.split(", ")
  .map((selector) => `${selector}${UNBADGED}`)
  .join(", ");

function* feedItemsWithin(subtree: Element, selector: string): Generator<Element> {
  if (subtree.matches(selector)) yield subtree;
  yield* subtree.querySelectorAll(selector);
}

export function observeRedditFeed(options: RedditFeedObserverOptions): () => void {
  const reported = new WeakSet<Element>();
  /** Near the viewport but not analysed yet, in the order they came near. */
  const queue = new Set<Element>();
  let pendingSubtrees: Element[] = [];
  let fullScanPending = true;
  let lastHref: string = window.location.href;
  let stopped = false;

  const report = (element: Element): void => {
    if (reported.has(element) || !element.isConnected) return;
    // A post without a usable author or anchor is left unmarked so the next full scan retries it
    // once its slotted content has rendered.
    const post: RedditPostRef | null = toPostRef(element);
    if (post === null) {
      // A deleted or removed author is not a missing anchor: there is nothing to badge.
      if (authorNameOf(element) !== undefined) recordAnchorMiss(kindOf(element) ?? "post", element);
      return;
    }
    recordSeen(post.kind, element);
    reported.add(element);
    options.onPost(post);
  };

  const forget = (subtree: Element): void => {
    for (const element of feedItemsWithin(subtree, FEED_ITEM_SELECTOR)) {
      gate.unwatch(element);
      queue.delete(element);
      if (!reported.delete(element)) continue;
      options.onRemoved(element);
    }
  };

  const discover = (): void => {
    const href: string = window.location.href;
    if (href !== lastHref) {
      lastHref = href;
      fullScanPending = true;
      options.onRouteChange?.(href);
    }
    const subtrees: Element[] = fullScanPending ? [document.documentElement] : pendingSubtrees;
    fullScanPending = false;
    pendingSubtrees = [];
    for (const subtree of subtrees) {
      if (!subtree.isConnected) continue;
      for (const element of feedItemsWithin(subtree, FEED_ITEM_SELECTOR)) {
        // Every post goes to the thread index, badged or not: the index forgets the page on navigation
        // and a reinjected script starts empty, while the badge marks survive both.
        options.onDiscovered?.(element);
        if (element.matches(UNDISCOVERED_SELECTOR)) gate.watch(element);
      }
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

  const observer = new MutationObserver((records: MutationRecord[]): void => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (node instanceof Element) forget(node);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) pendingSubtrees.push(node);
      }
    }
    scheduler.schedule();
  });
  const onPopState = (): void => {
    fullScanPending = true;
    scheduler.schedule();
  };

  observer.observe(document, { childList: true, subtree: true });
  window.addEventListener("popstate", onPopState);
  scheduler.schedule();

  return (): void => {
    stopped = true;
    observer.disconnect();
    window.removeEventListener("popstate", onPopState);
    scheduler.dispose();
    gate.disconnect();
  };
}
