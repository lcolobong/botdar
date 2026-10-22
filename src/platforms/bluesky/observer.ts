/**
 * Feed observer for bsky.app: one MutationObserver on the body, coalesced into a single discovery
 * pass per idle slot, that discovers post containers the badge has not marked yet and reports posts
 * the virtualised list has dropped. The analysis runs in budgeted slices (src/core/idleSlices.ts).
 * `pushState` is invisible to the isolated world, so route changes are detected by comparing
 * `location.href` on every pass plus `popstate`.
 */
import type { ShouldYield, SliceScheduler } from "../../core/idleSlices";
import { IDLE_TIMEOUT_MS, createSliceScheduler, drainQueue } from "../../core/idleSlices";
import type { PostRef } from "../../core/types";
import { UNMARKED_POST_SELECTOR, toPostRef } from "./dom";

export interface ObserveFeedOptions {
  onPost: (post: PostRef) => void;
  onRemoved: (element: Element) => void;
  onRouteChange?: (href: string) => void;
  root?: Document;
  /** The idle callback's deadline, and the plain timer when the browser has no idle callback. */
  idleTimeoutMs?: number;
}

export { IDLE_TIMEOUT_MS };

export function observeBlueskyFeed(options: ObserveFeedOptions): () => void {
  const root: Document = options.root ?? document;
  const view: Window = root.defaultView ?? window;
  const tracked = new Set<Element>();
  /** Discovered but not analysed yet, in document order. */
  const queue = new Set<Element>();
  let lastHref: string = root.location.href;
  let removalPending = false;
  let discoveryPending = true;

  const sweepRemoved = (): void => {
    for (const element of tracked) {
      if (!element.isConnected) {
        tracked.delete(element);
        options.onRemoved(element);
      }
    }
  };

  const analyse = (element: Element): void => {
    if (tracked.has(element) || !element.isConnected) {
      return;
    }
    const post: PostRef | undefined = toPostRef(element);
    if (post !== undefined) {
      tracked.add(element);
      options.onPost(post);
    }
  };

  const discover = (): void => {
    const href: string = root.location.href;
    if (href !== lastHref) {
      lastHref = href;
      removalPending = true;
      options.onRouteChange?.(href);
    }
    if (removalPending) {
      removalPending = false;
      sweepRemoved();
    }
    for (const element of root.querySelectorAll(UNMARKED_POST_SELECTOR)) {
      if (!tracked.has(element)) {
        queue.add(element);
      }
    }
  };

  const runSlice = (shouldYield: ShouldYield): boolean => {
    if (discoveryPending) {
      discoveryPending = false;
      discover();
    }
    return drainQueue(queue, analyse, shouldYield);
  };

  const scheduler: SliceScheduler = createSliceScheduler(
    view,
    options.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
    runSlice,
  );
  const schedule = (): void => {
    discoveryPending = true;
    scheduler.schedule();
  };

  const mutationObserver = new MutationObserver((records: MutationRecord[]): void => {
    if (records.some((record) => record.removedNodes.length > 0)) {
      removalPending = true;
    }
    schedule();
  });
  mutationObserver.observe(root.body, { childList: true, subtree: true });
  view.addEventListener("popstate", schedule);
  scheduler.runNow();

  return (): void => {
    mutationObserver.disconnect();
    view.removeEventListener("popstate", schedule);
    scheduler.dispose();
    tracked.clear();
    queue.clear();
  };
}
