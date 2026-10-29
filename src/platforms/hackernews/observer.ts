/**
 * Feed discovery for Hacker News (docs/architecture.md, "Hacker News"). Every page is rendered on
 * the server and navigation is a full page load, so one scan of the document finds everything; the
 * MutationObserver is there for the rows other scripts add (a "more" loader, a collapsed thread
 * re-rendered) and for rows they remove. As on Reddit, a row is only analysed once it comes near
 * the viewport (src/core/nearViewport.ts), in budgeted slices (src/core/idleSlices.ts), so a
 * thread of a thousand comments never blocks.
 */
import { UNBADGED } from "../../core/botdarMarks";
import type { ShouldYield, SliceScheduler } from "../../core/idleSlices";
import { IDLE_TIMEOUT_MS, createSliceScheduler, drainQueue } from "../../core/idleSlices";
import type { NearViewportGate } from "../../core/nearViewport";
import { createNearViewportGate } from "../../core/nearViewport";
import { recordAnchorMiss, recordSeen } from "../../core/diagnostics.ts";
import type { HackerNewsPostRef, HackerNewsRow } from "./dom";
import { FEED_ITEM_SELECTOR, classify } from "./dom";

export interface HackerNewsFeedObserverOptions {
  onPost: (post: HackerNewsPostRef) => void;
  onRemoved: (element: Element) => void;
  /**
   * Every row found by a discovery pass, near the viewport or not (the thread index, ADR-0027),
   * with the classification the badge will use, so a row is classified once.
   */
  onDiscovered?: (row: Element, classified: HackerNewsRow) => void;
}

export { IDLE_TIMEOUT_MS };

/** `BADGED_ATTRIBUTE` marks a row whose badge mounted; the wiring sets it so a reinjected script skips it. */
export const UNDISCOVERED_SELECTOR = `${FEED_ITEM_SELECTOR}${UNBADGED}`;

function* rowsWithin(subtree: Element, selector: string): Generator<Element> {
  if (subtree.matches(selector)) yield subtree;
  yield* subtree.querySelectorAll(selector);
}

export function observeHackerNewsFeed(options: HackerNewsFeedObserverOptions): () => void {
  const reported = new WeakSet<Element>();
  /** Each row's classification from its discovery, reused when it comes near the viewport. */
  const classifiedRows = new WeakMap<Element, HackerNewsRow>();
  /** Near the viewport but not analysed yet, in the order they came near. */
  const queue = new Set<Element>();
  let pendingSubtrees: Element[] = [document.documentElement];
  let stopped = false;

  const report = (row: Element): void => {
    if (reported.has(row) || !row.isConnected) return;
    const classified: HackerNewsRow = classifiedRows.get(row) ?? classify(row);
    // A job ad or a deleted comment has no author link and the user page's row is no post; only an
    // author link whose username could not be read is a miss.
    if (classified.status === "unreadableAuthor") recordAnchorMiss(classified.kind, row);
    if (classified.status !== "post") return;
    recordSeen(classified.post.kind, row);
    reported.add(row);
    options.onPost(classified.post);
  };

  const forget = (subtree: Element): void => {
    for (const row of rowsWithin(subtree, FEED_ITEM_SELECTOR)) {
      gate.unwatch(row);
      queue.delete(row);
      if (reported.delete(row)) options.onRemoved(row);
    }
  };

  const discover = (): void => {
    const subtrees: Element[] = pendingSubtrees;
    pendingSubtrees = [];
    for (const subtree of subtrees) {
      if (!subtree.isConnected) continue;
      for (const row of rowsWithin(subtree, FEED_ITEM_SELECTOR)) {
        // Every row goes to the thread index, badged or not: a reinjected script starts with an
        // empty index while the badge marks survive.
        const classified: HackerNewsRow = classify(row);
        classifiedRows.set(row, classified);
        options.onDiscovered?.(row, classified);
        if (row.matches(UNDISCOVERED_SELECTOR)) gate.watch(row);
      }
    }
  };

  const runSlice = (shouldYield: ShouldYield): boolean => {
    if (stopped) return false;
    discover();
    return drainQueue(queue, report, shouldYield);
  };

  const scheduler: SliceScheduler = createSliceScheduler(window, IDLE_TIMEOUT_MS, runSlice);
  const gate: NearViewportGate = createNearViewportGate(window, (row) => {
    queue.add(row);
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
  observer.observe(document, { childList: true, subtree: true });
  scheduler.schedule();

  return (): void => {
    stopped = true;
    observer.disconnect();
    scheduler.dispose();
    gate.disconnect();
  };
}
