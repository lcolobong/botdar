/**
 * Feed observer for X (docs/architecture.md, "X", Observer and Routing). One MutationObserver on
 * the body, coalesced into a single pass per idle period; removed posts are released because X
 * virtualizes its list; `pushState` is invisible to the isolated world, so the URL is compared on
 * every pass and on popstate.
 */
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
export const PASS_DELAY_MS = 150;

const ELEMENT_NODE = 1;

export function observeFeed(options: FeedObserverOptions): () => void {
  const root: Document = options.root ?? document;
  const view: (Window & typeof globalThis) | null = root.defaultView;
  if (view === null) {
    return () => undefined;
  }
  const tracked = new WeakMap<Element, PostRef>();
  let lastHref: string = view.location.href;
  let pendingPass: number | undefined;
  let stopped = false;

  const release = (element: Element): void => {
    if (tracked.delete(element)) {
      options.onRemoved(element);
    }
  };

  const pass = (): void => {
    pendingPass = undefined;
    if (stopped) {
      return;
    }
    if (view.location.href !== lastHref) {
      lastHref = view.location.href;
      options.onRouteChange?.(lastHref);
    }
    for (const article of findUnbadgedPosts(root)) {
      if (tracked.has(article)) {
        continue;
      }
      const post: PostRef | undefined = toPostRef(article);
      if (post !== undefined) {
        tracked.set(article, post);
        options.onPost(post);
      }
    }
  };

  const schedule = (): void => {
    if (pendingPass !== undefined || stopped) {
      return;
    }
    pendingPass =
      typeof view.requestIdleCallback === "function"
        ? view.requestIdleCallback(pass, { timeout: PASS_DELAY_MS })
        : view.setTimeout(pass, PASS_DELAY_MS);
  };

  const cancelPending = (): void => {
    if (pendingPass === undefined) {
      return;
    }
    if (typeof view.cancelIdleCallback === "function") {
      view.cancelIdleCallback(pendingPass);
    }
    view.clearTimeout(pendingPass);
    pendingPass = undefined;
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
    cancelPending();
    observer.disconnect();
    view.removeEventListener("popstate", schedule);
  };
}
