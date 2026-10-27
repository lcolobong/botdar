// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://news.ycombinator.com/item?id=1"}

import { diagnosticsSnapshot, resetDiagnostics } from "@/src/core/diagnostics";
import type { HackerNewsPostRef } from "@/src/platforms/hackernews/dom";
import {
  IDLE_TIMEOUT_MS,
  UNDISCOVERED_SELECTOR,
  observeHackerNewsFeed,
} from "@/src/platforms/hackernews/observer";
import { DELETED_COMMENT_ROW, JOB_AD_ROWS, loadHackerNewsFixture, loadRows } from "./fixtures";

interface Harness {
  posts: HackerNewsPostRef[];
  removed: Element[];
  stop: () => void;
}

function observe(): Harness {
  const harness: Harness = { posts: [], removed: [], stop: () => undefined };
  harness.stop = observeHackerNewsFeed({
    onPost: (post) => harness.posts.push(post),
    onRemoved: (element) => harness.removed.push(element),
  });
  return harness;
}

/** Lets the MutationObserver deliver, then runs the coalesced pass. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
}

describe("observeHackerNewsFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    resetDiagnostics();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips rows that already carry data-botdar", () => {
    expect(UNDISCOVERED_SELECTOR).toBe("tr.athing:not([data-botdar])");
  });

  it("reports the story and every comment of a recorded thread once, in page order", async () => {
    loadHackerNewsFixture("thread");
    const harness: Harness = observe();
    await settle();
    await settle();
    expect(harness.posts).toHaveLength(83);
    expect(harness.posts[0]?.kind).toBe("post");
    expect(new Set(harness.posts.map((post) => post.element)).size).toBe(83);
    expect(diagnosticsSnapshot().kinds.comment).toEqual({ seen: 82, badged: 0, anchorMisses: 0 });
    expect(diagnosticsSnapshot().kinds.post).toEqual({ seen: 1, badged: 0, anchorMisses: 0 });
    harness.stop();
  });

  it("reports nothing on a user page and counts no miss for a job ad or a deleted comment", async () => {
    loadHackerNewsFixture("user");
    document.body.insertAdjacentHTML(
      "beforeend",
      `<table>${JOB_AD_ROWS}${DELETED_COMMENT_ROW}</table>`,
    );
    const harness: Harness = observe();
    await settle();
    expect(harness.posts).toHaveLength(0);
    const { post, comment } = diagnosticsSnapshot().kinds;
    expect(post.anchorMisses + comment.anchorMisses).toBe(0);
    harness.stop();
  });

  it("reports rows added later and forgets rows that leave the page", async () => {
    loadRows("");
    const harness: Harness = observe();
    await settle();
    const parsed: HTMLTableElement = document.createElement("table");
    parsed.innerHTML = `<tr class="athing comtr" id="1000010"><td><span class="comhead"><a href="user?id=late_reader" class="hnuser">late_reader</a></span><div class="comment">Late</div></td></tr>`;
    const lateRow: Element | null = parsed.querySelector("tr");
    if (lateRow !== null) document.querySelector("tbody")?.append(lateRow);
    await settle();
    expect(harness.posts.map((post) => post.ref.handle)).toEqual(["late_reader"]);

    const row: Element | undefined = harness.posts[0]?.element;
    row?.remove();
    await settle();
    expect(harness.removed).toEqual([row]);
    harness.stop();
  });

  it("ignores rows marked by an earlier script instance", async () => {
    loadHackerNewsFixture("front");
    document.querySelector("tr.athing")?.setAttribute("data-botdar", "1");
    const harness: Harness = observe();
    await settle();
    await settle();
    expect(harness.posts).toHaveLength(29);
    harness.stop();
  });
});
