/**
 * Feed observer for X (docs/architecture.md, "X", Observer and Routing). One MutationObserver on
 * the body, coalesced into a single discovery pass per idle period; a discovered post is analysed
 * once it comes near the viewport (src/core/nearViewport.ts), in budgeted slices
 * (src/core/idleSlices.ts); removed posts are released because X virtualizes its list;
 * `pushState` is invisible to the isolated world, so the URL is compared on every pass and on
 * popstate.
 */
import type { ShouldYield, SliceScheduler } from "@/src/core/idleSlices";
import { IDLE_TIMEOUT_MS, createSliceScheduler, drainQueue } from "@/src/core/idleSlices";
import type { NearViewportGate } from "@/src/core/nearViewport";
import { createNearViewportGate } from "@/src/core/nearViewport";
import type { PostRef } from "@/src/core/types";
import { POST_SELECTOR, findUnbadgedPosts, toPostRef } from "./dom";

export interface FeedObserverOptions {
  onPost: (post: PostRef) => void;
  onRemoved: (element: Element) => void;
  /** Called with the new URL before the first pass on it; per-page state resets here. */
  onRouteChange?: (href: string) => void;
  root?: Document;
}

/** Longest wait for an idle slot, and the plain timer delay where requestIdleCallback is missing. */
export const PASS_DELAY_MS: number = IDLE_TIMEOUT_MS;

const ELEMENT_NODE = 1;

export function observeFeed(options: FeedObserverOptions): () => void {
  const root: Document = options.root ?? document;
  const view: (Window & typeof globalThis) | null = root.defaultView;
  if (view === null) {
    return () => undefined;
  }
  const tracked = new WeakMap<Element, PostRef>();
  /** Near the viewport but not analysed yet, in the order they came near. */
  const queue = new Set<Element>();
  let lastHref: string = view.location.href;
  let discoveryPending = true;
  let stopped = false;

  const release = (element: Element): void => {
    gate.unwatch(element);
    queue.delete(element);
    if (tracked.delete(element)) {
      options.onRemoved(element);
    }
  };

  const analyse = (article: Element): void => {
    if (tracked.has(article) || !article.isConnected) {
      return;
    }
    const post: PostRef | undefined = toPostRef(article);
    if (post !== undefined) {
      tracked.set(article, post);
      options.onPost(post);
    }
  };

  const discover = (): void => {
    if (view.location.href !== lastHref) {
      lastHref = view.location.href;
      options.onRouteChange?.(lastHref);
    }
    for (const article of findUnbadgedPosts(root)) {
      if (!tracked.has(article)) {
        gate.watch(article);
      }
    }
  };

  const runSlice = (shouldYield: ShouldYield): boolean => {
    if (stopped) {
      return false;
    }
    if (discoveryPending) {
      discoveryPending = false;
      discover();
    }
    return drainQueue(queue, analyse, shouldYield);
  };

  const scheduler: SliceScheduler = createSliceScheduler(view, PASS_DELAY_MS, runSlice);
  const gate: NearViewportGate = createNearViewportGate(view, (article) => {
    queue.add(article);
    scheduler.schedule();
  });
  const schedule = (): void => {
    discoveryPending = true;
    scheduler.schedule();
  };

  const onMutations = (records: MutationRecord[]): void => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (node.nodeType !== ELEMENT_NODE || node.isConnected) {
          continue;
        }
        const removed = node as Element;
        release(removed);
        for (const nested of removed.querySelectorAll(POST_SELECTOR)) {
          release(nested);
        }
      }
    }
    schedule();
  };

  const observer = new view.MutationObserver(onMutations);
  observer.observe(root.body, { childList: true, subtree: true });
  view.addEventListener("popstate", schedule);
  schedule();

  return () => {
    stopped = true;
    scheduler.dispose();
    gate.disconnect();
    observer.disconnect();
    view.removeEventListener("popstate", schedule);
  };
}
