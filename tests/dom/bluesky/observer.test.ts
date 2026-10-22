// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://bsky.app/"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PostRef } from "@/src/core/types";
import { IDLE_TIMEOUT_MS, observeBlueskyFeed } from "@/src/platforms/bluesky/observer";

const FEED_HTML: string = readFileSync(
  join(import.meta.dirname, "..", "..", "fixtures", "bluesky", "html", "feed.html"),
  "utf8",
);

interface Harness {
  posts: PostRef[];
  removed: Element[];
  routes: string[];
  stop: () => void;
}

const start = (): Harness => {
  const harness: Harness = { posts: [], removed: [], routes: [], stop: () => undefined };
  harness.stop = observeBlueskyFeed({
    onPost: (post) => harness.posts.push(post),
    onRemoved: (element) => harness.removed.push(element),
    onRouteChange: (href) => harness.routes.push(href),
  });
  return harness;
};

const makePost = (handle: string): HTMLElement => {
  const post = document.createElement("div");
  post.dataset.testid = `feedItem-by-${handle}`;
  post.innerHTML = `<a href="/profile/${handle}"><span>@${handle}</span></a>`;
  return post;
};

/** MutationObserver callbacks are microtasks in happy-dom; the pass itself waits on the timer. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
};

describe("observeBlueskyFeed", () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    // happy-dom ships requestIdleCallback; the default path under test is the timer fallback.
    Object.assign(window, { requestIdleCallback: undefined });
    document.documentElement.innerHTML = FEED_HTML;
    harness = start();
  });

  afterEach(() => {
    harness.stop();
    vi.useRealTimers();
  });

  it("reports the unmarked, attributable posts already on the page in document order", () => {
    expect(harness.posts.map((post) => post.ref.handle)).toEqual([
      "alice.example.com",
      "kai09127364.bsky.social",
      "newsroom.example.org",
      "mila48213907.bsky.social",
    ]);
  });

  it("reports an appended post once, after the coalesced pass", async () => {
    document.body.append(makePost("new.example.com"));
    document.body.append(makePost("newer.example.com"));
    expect(harness.posts).toHaveLength(4);

    await settle();

    expect(harness.posts.map((post) => post.ref.handle).slice(4)).toEqual([
      "new.example.com",
      "newer.example.com",
    ]);
    await settle();
    expect(harness.posts).toHaveLength(6);
  });

  it("does not report a post again while it is still on the page", async () => {
    document.body.append(document.createElement("p"));
    await settle();
    expect(harness.posts).toHaveLength(4);
  });

  it("reports removed posts, including those removed with an ancestor", async () => {
    const alice: PostRef | undefined = harness.posts[0];
    const wrapper = document.createElement("section");
    const wrapped: HTMLElement = makePost("wrapped.example.com");
    wrapper.append(wrapped);
    document.body.append(wrapper);
    await settle();
    expect(harness.posts).toHaveLength(5);

    alice?.element.remove();
    wrapper.remove();
    await settle();

    expect(harness.removed).toEqual([alice?.element, wrapped]);
  });

  it("notices a route change on the next pass and sweeps what the new page dropped", async () => {
    const kai: PostRef | undefined = harness.posts[1];
    history.pushState({}, "", "/profile/alice.example.com");
    kai?.element.remove();
    window.dispatchEvent(new PopStateEvent("popstate"));

    await settle();

    expect(harness.routes).toEqual(["https://bsky.app/profile/alice.example.com"]);
    expect(harness.removed).toEqual([kai?.element]);
  });

  it("prefers requestIdleCallback with the timeout as its deadline", async () => {
    harness.stop();
    const requestIdleCallback = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });
    Object.assign(window, { requestIdleCallback });
    harness = start();

    document.body.append(makePost("idle.example.com"));
    await Promise.resolve();

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: IDLE_TIMEOUT_MS,
    });
    expect(harness.posts.at(-1)?.ref.handle).toBe("idle.example.com");
  });

  it("stops reporting after stop", async () => {
    harness.stop();
    document.body.append(makePost("late.example.com"));
    await settle();
    expect(harness.posts).toHaveLength(4);
  });
});
