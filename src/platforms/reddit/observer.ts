/**
 * Feed discovery for Reddit (docs/architecture.md, "Reddit"). One MutationObserver on the document
 * is enough: new posts and comments arrive in light DOM (`shreddit-feed`, `shreddit-comment-tree`,
 * `faceplate-partial`), and a mutation inside a shadow root never adds a post. Passes are coalesced
 * through requestIdleCallback so a burst of feed chunks costs one scan.
 *
 * Reddit's SPA navigation uses pushState, which the isolated world cannot hook, so every pass
 * compares the location to the last one seen and `popstate` covers the back button.
 */
import type { RedditPostRef } from "./dom";
import { FEED_ITEM_SELECTOR, toPostRef } from "./dom";

export interface RedditFeedObserverOptions {
  onPost: (post: RedditPostRef) => void;
  onRemoved: (element: Element) => void;
  /** The page navigated in place; per-page UI state can reset while account caches survive. */
  onRouteChange?: (href: string) => void;
}

/** Longest a pass waits for an idle slot before running anyway. */
export const IDLE_TIMEOUT_MS = 150;

/** `data-botdar` marks a post whose badge mounted; the wiring sets it so a reinjected script skips it. */
export const UNDISCOVERED_SELECTOR: string = FEED_ITEM_SELECTOR.split(", ")
  .map((selector) => `${selector}:not([data-botdar])`)
  .join(", ");

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function* feedItemsWithin(subtree: Element, selector: string): Generator<Element> {
  if (subtree.matches(selector)) yield subtree;
  yield* subtree.querySelectorAll(selector);
}

export function observeRedditFeed(options: RedditFeedObserverOptions): () => void {
  const view: IdleWindow = window;
  const reported = new WeakSet<Element>();
  let pendingSubtrees: Element[] = [];
  let fullScanPending = true;
  let lastHref: string = view.location.href;
  let cancelScheduled: (() => void) | undefined;
  let stopped = false;

  const report = (element: Element): void => {
    if (reported.has(element)) return;
    // A post without a usable author or anchor is left unmarked so the next full scan retries it
    // once its slotted content has rendered.
    const post: RedditPostRef | null = toPostRef(element);
    if (post === null) return;
    reported.add(element);
    options.onPost(post);
  };

  const forget = (subtree: Element): void => {
    for (const element of feedItemsWithin(subtree, FEED_ITEM_SELECTOR)) {
      if (!reported.delete(element)) continue;
      options.onRemoved(element);
    }
  };

  const runPass = (): void => {
    cancelScheduled = undefined;
    if (stopped) return;
    const href: string = view.location.href;
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
      for (const element of feedItemsWithin(subtree, UNDISCOVERED_SELECTOR)) report(element);
    }
  };

  const schedulePass = (): void => {
    if (cancelScheduled !== undefined || stopped) return;
    if (typeof view.requestIdleCallback === "function") {
      const handle: number = view.requestIdleCallback(runPass, { timeout: IDLE_TIMEOUT_MS });
      cancelScheduled = () => view.cancelIdleCallback?.(handle);
    } else {
      const handle: number = view.setTimeout(runPass, IDLE_TIMEOUT_MS);
      cancelScheduled = () => view.clearTimeout(handle);
    }
  };

  const observer = new MutationObserver((records: MutationRecord[]): void => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (node instanceof Element) forget(node);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) pendingSubtrees.push(node);
      }
    }
    schedulePass();
  });
  const onPopState = (): void => {
    fullScanPending = true;
    schedulePass();
  };

  observer.observe(document, { childList: true, subtree: true });
  view.addEventListener("popstate", onPopState);
  schedulePass();

  return (): void => {
    stopped = true;
    observer.disconnect();
    view.removeEventListener("popstate", onPopState);
    cancelScheduled?.();
    cancelScheduled = undefined;
  };
}
