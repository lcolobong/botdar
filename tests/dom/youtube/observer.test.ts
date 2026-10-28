// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.youtube.com/watch?v=fs4k4h1v9go"}

import { diagnosticsSnapshot, resetDiagnostics } from "@/src/core/diagnostics";
import { IDLE_TIMEOUT_MS } from "@/src/core/idleSlices";
import type { YouTubeComment, YouTubeCommentRef } from "@/src/platforms/youtube/dom";
import {
  NAVIGATE_FINISH_EVENT,
  UNDISCOVERED_SELECTOR,
  observeYouTubeComments,
  pageKeyOf,
} from "@/src/platforms/youtube/observer";
import { RECORDED_WATCH_URL, commentMarkup, loadWatchFixture } from "./fixtures";

interface Harness {
  posts: YouTubeCommentRef[];
  removed: Element[];
  discovered: Array<YouTubeComment["status"]>;
  navigations: number;
  passes: number;
  stop: () => void;
}

function observe(): Harness {
  const harness: Harness = {
    posts: [],
    removed: [],
    discovered: [],
    navigations: 0,
    passes: 0,
    stop: () => undefined,
  };
  harness.stop = observeYouTubeComments({
    onPost: (post) => harness.posts.push(post),
    onRemoved: (element) => harness.removed.push(element),
    onDiscovered: (_element, classified) => harness.discovered.push(classified.status),
    onPass: () => {
      harness.passes += 1;
    },
    onNavigated: () => {
      harness.navigations += 1;
    },
  });
  return harness;
}

/** Markup inside the comment section, the only part of the page the observer scans after load. */
const inCommentSection = (markup: string): string =>
  `<ytd-comments id="comments">${markup}</ytd-comments>`;

/** Re-binds a comment element's author link to another handle, as Polymer does in place. */
function rebind(element: Element | undefined, handle: string): void {
  const link: Element | null | undefined = element?.querySelector("#author-text");
  link?.setAttribute("href", `/@${handle}`);
  if (link !== null && link !== undefined) link.innerHTML = `<span> @${handle} </span>`;
}

/** Lets the MutationObserver deliver, then runs the coalesced pass. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
}

describe("observeYouTubeComments", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", RECORDED_WATCH_URL);
    document.body.innerHTML = "";
    resetDiagnostics();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips comments that already carry data-botdar", () => {
    expect(UNDISCOVERED_SELECTOR).toBe("ytd-comment-view-model:not([data-botdar])");
  });

  it("reports every comment and reply of the recorded page once, in page order", async () => {
    loadWatchFixture();
    const harness: Harness = observe();
    await settle();
    await settle();
    expect(harness.posts).toHaveLength(60);
    expect(new Set(harness.posts.map((post) => post.element)).size).toBe(60);
    expect(harness.posts[0]?.ref.handle).toBe("alice_reads61");
    expect(harness.passes).toBeGreaterThan(0);
    expect(diagnosticsSnapshot().kinds.comment).toEqual({ seen: 60, badged: 0, anchorMisses: 0 });
    harness.stop();
  });

  it("reports comments a continuation appends and forgets removed ones", async () => {
    document.body.innerHTML = inCommentSection(
      `<div id="contents">${commentMarkup({ handle: "maria_reads40" })}</div>`,
    );
    const harness: Harness = observe();
    await settle();
    const contents: Element | null = document.querySelector("#contents");
    contents?.insertAdjacentHTML("beforeend", commentMarkup({ handle: "lena_runs12" }));
    await settle();
    expect(harness.posts.map((post) => post.ref.handle)).toEqual(["maria_reads40", "lena_runs12"]);
    const first: Element | undefined = harness.posts[0]?.element;
    first?.remove();
    await settle();
    expect(harness.removed).toEqual([first]);
    harness.stop();
  });

  it("discovers a comment again once Polymer binds its author link", async () => {
    document.body.innerHTML = inCommentSection(
      commentMarkup({ handle: "maria_reads40" }).replace(
        /<a id="author-text" href="\/@maria_reads40"><span> @maria_reads40 <\/span><\/a>/,
        '<a id="author-text"></a>',
      ),
    );
    const harness: Harness = observe();
    await settle();
    expect(harness.posts).toHaveLength(0);
    const link: Element | null = document.querySelector("#author-text");
    link?.setAttribute("href", "/@maria_reads40");
    link?.insertAdjacentHTML("beforeend", "<span> @maria_reads40 </span>");
    await settle();
    expect(harness.posts.map((post) => post.ref.handle)).toEqual(["maria_reads40"]);
    expect(harness.discovered).toEqual(["unreadableAuthor", "comment"]);
    harness.stop();
  });

  it("reports a recycled comment element under its new author, not the one it was first read for", async () => {
    document.body.innerHTML = inCommentSection(
      `<div id="contents">${commentMarkup({ handle: "maria_reads40" })}</div>`,
    );
    const harness: Harness = observe();
    await settle();
    const element: Element | undefined = harness.posts[0]?.element;
    element?.remove();
    await settle();
    // Polymer stamps the same element for another comment and puts it back.
    rebind(element, "lena_runs12");
    if (element !== undefined) document.querySelector("#contents")?.append(element);
    await settle();
    expect(harness.removed).toEqual([element]);
    expect(harness.posts.map((post) => post.ref.handle)).toEqual(["maria_reads40", "lena_runs12"]);
    harness.stop();
  });

  it("re-reports a comment whose author link is re-bound in place, as a re-sort does", async () => {
    document.body.innerHTML = inCommentSection(commentMarkup({ handle: "maria_reads40" }));
    const harness: Harness = observe();
    await settle();
    const element: Element | undefined = harness.posts[0]?.element;
    rebind(element, "lena_runs12");
    await settle();
    expect(harness.removed).toEqual([element]);
    expect(harness.posts.map((post) => post.ref.handle)).toEqual(["maria_reads40", "lena_runs12"]);
    harness.stop();
  });

  it("does not scan nodes added outside the comment section, such as the player's", async () => {
    document.body.innerHTML = `<div id="player"></div>${inCommentSection("")}`;
    const harness: Harness = observe();
    await settle();
    const passes: number = harness.passes;
    document.querySelector("#player")?.insertAdjacentHTML("beforeend", "<div>tooltip</div>");
    await settle();
    expect(harness.passes).toBe(passes);
    harness.stop();
  });

  it("treats a timestamp or playlist on the same video as the same page", async () => {
    document.body.innerHTML = inCommentSection(commentMarkup({ handle: "maria_reads40" }));
    const harness: Harness = observe();
    await settle();
    history.pushState(null, "", `${RECORDED_WATCH_URL}&t=95s&list=PLabc&index=3`);
    document.dispatchEvent(new Event(NAVIGATE_FINISH_EVENT));
    await settle();
    expect(harness.navigations).toBe(0);
    expect(harness.removed).toEqual([]);
    expect(pageKeyOf(new URL(`${RECORDED_WATCH_URL}&t=95s`))).toBe(
      pageKeyOf(new URL(RECORDED_WATCH_URL)),
    );
    harness.stop();
  });

  it("on navigation reports every badged comment removed and reads the reused elements again", async () => {
    document.body.innerHTML = inCommentSection(commentMarkup({ handle: "maria_reads40" }));
    const harness: Harness = observe();
    await settle();
    const element: Element | undefined = harness.posts[0]?.element;
    // YouTube reuses the comment element for the next video's comment.
    history.pushState(null, "", "https://www.youtube.com/watch?v=aaaaaaaaaaa");
    rebind(element, "lena_runs12");
    document.dispatchEvent(new Event(NAVIGATE_FINISH_EVENT));
    await settle();
    expect(harness.navigations).toBe(1);
    expect(harness.removed).toEqual([element]);
    expect(harness.posts.map((post) => post.ref.handle)).toEqual(["maria_reads40", "lena_runs12"]);
    harness.stop();
  });
});
