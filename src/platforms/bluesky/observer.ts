/**
 * Feed observer for bsky.app: one MutationObserver on the body, coalesced into a single pass per
 * idle slot, that discovers post containers the badge has not marked yet and reports posts the
 * virtualised list has dropped. `pushState` is invisible to the isolated world, so route changes
 * are detected by comparing `location.href` on every pass plus `popstate`.
 */
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

export const IDLE_TIMEOUT_MS = 150;

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function observeBlueskyFeed(options: ObserveFeedOptions): () => void {
  const root: Document = options.root ?? document;
  const view: IdleCapableWindow | null = root.defaultView;
  const idleTimeoutMs: number = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const tracked = new Set<Element>();
  let lastHref: string = root.location.href;
  let removalPending = false;
  let cancelScheduled: (() => void) | undefined;

  const sweepRemoved = (): void => {
    for (const element of tracked) {
      if (!element.isConnected) {
        tracked.delete(element);
        options.onRemoved(element);
      }
    }
  };

  const scan = (): void => {
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
      if (tracked.has(element)) {
        continue;
      }
      const post: PostRef | undefined = toPostRef(element);
      if (post !== undefined) {
        tracked.add(element);
        options.onPost(post);
      }
    }
  };

  const schedule = (): void => {
    if (cancelScheduled !== undefined) {
      return;
    }
    const run = (): void => {
      cancelScheduled = undefined;
      scan();
    };
    if (view?.requestIdleCallback !== undefined) {
      const handle: number = view.requestIdleCallback(run, { timeout: idleTimeoutMs });
      cancelScheduled = () => view.cancelIdleCallback?.(handle);
    } else {
      const handle: ReturnType<typeof setTimeout> = setTimeout(run, idleTimeoutMs);
      cancelScheduled = () => clearTimeout(handle);
    }
  };

  const mutationObserver = new MutationObserver((records: MutationRecord[]): void => {
    if (records.some((record) => record.removedNodes.length > 0)) {
      removalPending = true;
    }
    schedule();
  });
  mutationObserver.observe(root.body, { childList: true, subtree: true });
  view?.addEventListener("popstate", schedule);
  scan();

  return (): void => {
    mutationObserver.disconnect();
    view?.removeEventListener("popstate", schedule);
    cancelScheduled?.();
    cancelScheduled = undefined;
    tracked.clear();
  };
}
