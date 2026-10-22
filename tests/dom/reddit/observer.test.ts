// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/"}

import type { RedditPostRef } from "@/src/platforms/reddit/dom";
import {
  IDLE_TIMEOUT_MS,
  UNDISCOVERED_SELECTOR,
  observeRedditFeed,
} from "@/src/platforms/reddit/observer";
import { OLD_REDDIT_POST, loadRedditFixture, snippet } from "./fixtures";

interface Harness {
  posts: RedditPostRef[];
  removed: Element[];
  routes: string[];
  stop: () => void;
}

function observe(): Harness {
  const harness: Harness = { posts: [], removed: [], routes: [], stop: () => undefined };
  harness.stop = observeRedditFeed({
    onPost: (post) => harness.posts.push(post),
    onRemoved: (element) => harness.removed.push(element),
    onRouteChange: (href) => harness.routes.push(href),
  });
  return harness;
}

/** Lets the MutationObserver deliver, then runs the coalesced pass. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
}

const handles = (posts: RedditPostRef[]): string[] => posts.map((post) => post.ref.handle);

describe("observeRedditFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips posts that already carry data-botdar", () => {
    expect(UNDISCOVERED_SELECTOR).toBe(
      "shreddit-post:not([data-botdar]), shreddit-comment:not([data-botdar]), .thing[data-author]:not([data-botdar])",
    );
  });

  it("reports the posts already on the page in one initial pass", async () => {
    loadRedditFixture("feed.html");
    const harness: Harness = observe();
    expect(harness.posts).toHaveLength(0);

    await settle();

    expect(handles(harness.posts)).toEqual(["quiet_lantern_4821", "brisk_falcon_2210"]);
    harness.stop();
  });

  it("reports posts and comments added later, once each, however many mutations arrive", async () => {
    const harness: Harness = observe();
    await settle();
    loadRedditFixture("comments.html");
    const feed: Element = snippet(OLD_REDDIT_POST);
    document.body.append(feed);

    await settle();

    expect(handles(harness.posts)).toEqual([
      "quiet_lantern_4821",
      "mossy_teapot",
      "quiet_lantern_4821",
      "deal_scout_90210",
      "quiet_lantern_4821",
    ]);
    await settle();
    expect(harness.posts).toHaveLength(5);
    harness.stop();
  });

  it("ignores posts marked by an earlier script instance", async () => {
    loadRedditFixture("feed.html");
    document.querySelector("shreddit-post")?.setAttribute("data-botdar", "1");
    const harness: Harness = observe();

    await settle();

    expect(handles(harness.posts)).toEqual(["brisk_falcon_2210"]);
    harness.stop();
  });

  it("reports removed posts, including those inside a removed subtree", async () => {
    loadRedditFixture("feed.html");
    const harness: Harness = observe();
    await settle();
    const first: Element | null = document.querySelector("shreddit-post");
    const feed: Element | null = document.querySelector("shreddit-feed");
    if (first === null || feed === null) throw new Error("fixture missing");

    first.remove();
    await settle();
    expect(harness.removed).toEqual([first]);

    feed.remove();
    await settle();
    expect(harness.removed).toHaveLength(2);
    expect(harness.removed[1]?.getAttribute("author")).toBe("Brisk_Falcon_2210");
    harness.stop();
  });

  it("re-reports a post that is removed and re-inserted", async () => {
    loadRedditFixture("feed.html");
    const harness: Harness = observe();
    await settle();
    const first: Element | null = document.querySelector("shreddit-post");
    const feed: Element | null = document.querySelector("shreddit-feed");
    if (first === null || feed === null) throw new Error("fixture missing");

    first.remove();
    await settle();
    feed.append(first);
    await settle();

    expect(harness.removed).toEqual([first]);
    expect(harness.posts).toHaveLength(3);
    harness.stop();
  });

  it("detects an in-page navigation on the next pass and rescans", async () => {
    loadRedditFixture("feed.html");
    const harness: Harness = observe();
    await settle();

    window.history.pushState(null, "", "/r/woodworking/");
    document.body.append(document.createElement("div"));
    await settle();

    expect(harness.routes).toEqual(["https://www.reddit.com/r/woodworking/"]);
    expect(harness.posts).toHaveLength(2);
    harness.stop();
  });

  it("rescans on popstate", async () => {
    const harness: Harness = observe();
    await settle();
    loadRedditFixture("feed.html");
    await settle();
    for (const post of harness.posts) post.element.setAttribute("data-botdar", "1");
    document.querySelector("shreddit-post")?.removeAttribute("data-botdar");

    window.dispatchEvent(new Event("popstate"));
    await settle();

    expect(harness.posts).toHaveLength(2);
    harness.stop();
  });

  it("uses requestIdleCallback with the timeout when the host offers it", async () => {
    const requestIdleCallback = vi.fn((callback: () => void): number => {
      callback();
      return 1;
    });
    Object.assign(window, { requestIdleCallback });
    loadRedditFixture("feed.html");
    const harness: Harness = observe();

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: IDLE_TIMEOUT_MS,
    });
    expect(harness.posts).toHaveLength(2);
    harness.stop();
    Object.assign(window, { requestIdleCallback: undefined });
  });

  it("analyses a long thread in slices, yielding when the idle period runs out", () => {
    const callbacks: Array<(deadline: IdleDeadline) => void> = [];
    const requestIdleCallback = vi.fn((callback: (deadline: IdleDeadline) => void): number => {
      callbacks.push(callback);
      return callbacks.length;
    });
    Object.assign(window, { requestIdleCallback });
    loadRedditFixture("comments.html");
    const harness: Harness = observe();
    const exhausted: IdleDeadline = { didTimeout: false, timeRemaining: () => 0 };

    callbacks.shift()?.(exhausted);
    expect(handles(harness.posts)).toEqual(["quiet_lantern_4821"]);
    callbacks.shift()?.(exhausted);
    expect(handles(harness.posts)).toEqual(["quiet_lantern_4821", "mossy_teapot"]);
    while (callbacks.length > 0) callbacks.shift()?.(exhausted);
    expect(harness.posts).toHaveLength(4);

    harness.stop();
    Object.assign(window, { requestIdleCallback: undefined });
  });

  it("stops reporting after stop", async () => {
    const harness: Harness = observe();
    harness.stop();
    loadRedditFixture("feed.html");

    await settle();

    expect(harness.posts).toHaveLength(0);
  });
});
