// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/r/woodworking/comments/1k9x2ab/walnut_table_copied_replies/"}

import type { AccountSignals, Feature, PlatformAdapter, PostRef } from "@/src/core/types";
import { createRedditAdapter } from "@/src/platforms/reddit/adapter";
import { IDLE_TIMEOUT_MS } from "@/src/platforms/reddit/observer";
import { loadRedditFixture } from "./fixtures";

function copiedReplies(adapter: PlatformAdapter, handle: string): Feature["value"] | undefined {
  const signals: AccountSignals = {
    ref: { platform: "reddit", handle },
    provenance: {},
    tiersDelivered: [0],
    observedAt: 0,
  };
  return adapter.toFeatures(signals).find((feature) => feature.id === "thread.nearDuplicateReply")
    ?.value;
}

function sharedDomains(adapter: PlatformAdapter, handle: string): Feature["value"] | undefined {
  const signals: AccountSignals = {
    ref: { platform: "reddit", handle },
    provenance: {},
    tiersDelivered: [0],
    observedAt: 0,
  };
  return adapter.toFeatures(signals).find((feature) => feature.id === "thread.sharedRareDomain")
    ?.value;
}

describe("createRedditAdapter on a thread with shared links", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts the earlier linkers of a small site, never the post's own site", async () => {
    window.history.pushState(
      null,
      "",
      "/r/harbourcity/comments/1kb4c7d/council_votes_to_close_the_harbour_street_bridge/",
    );
    const adapter: PlatformAdapter = createRedditAdapter({ sources: [] });
    loadRedditFixture("shared-links.html");
    const stop: () => void = adapter.observeFeed(
      () => undefined,
      () => undefined,
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);

    expect(sharedDomains(adapter, "tidal_quill_5530")).toBe(5);
    expect(sharedDomains(adapter, "amber_wren_4471")).toBe(0);
    expect(sharedDomains(adapter, "rusty_kettle")).toBeUndefined();
    expect(sharedDomains(adapter, "fern_garden")).toBeUndefined();
    stop();
    window.history.back();
  });
});

describe("createRedditAdapter on a comment thread", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("indexes every comment on discovery, before any of them is analysed", async () => {
    const adapter: PlatformAdapter = createRedditAdapter({ sources: [] });
    loadRedditFixture("copied-replies.html");
    const onPost = vi.fn<(post: PostRef) => void>();
    const stop: () => void = adapter.observeFeed(onPost, () => undefined);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);

    expect(copiedReplies(adapter, "bright_sail_8803")).toBe(2);
    expect(copiedReplies(adapter, "quick_fern_2291")).toBe(1);
    expect(copiedReplies(adapter, "mossy_teapot")).toBe(0);
    expect(copiedReplies(adapter, "quiet_lantern_4821")).toBe(0);
    stop();
  });

  it("indexes comments already badged by an earlier script", async () => {
    const adapter: PlatformAdapter = createRedditAdapter({ sources: [] });
    loadRedditFixture("copied-replies.html");
    for (const comment of document.querySelectorAll("shreddit-comment")) {
      comment.setAttribute("data-botdar", "1");
    }
    const onPost = vi.fn<(post: PostRef) => void>();
    const stop: () => void = adapter.observeFeed(onPost, () => undefined);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);

    expect(copiedReplies(adapter, "bright_sail_8803")).toBe(2);
    expect(onPost.mock.calls.map(([post]) => post.kind)).toEqual(["post"]);
    stop();
  });

  it("indexes the badged comments that survive an in-place navigation again", async () => {
    const adapter: PlatformAdapter = createRedditAdapter({ sources: [] });
    loadRedditFixture("copied-replies.html");
    const stop: () => void = adapter.observeFeed(
      () => undefined,
      () => undefined,
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
    for (const comment of document.querySelectorAll("shreddit-comment")) {
      comment.setAttribute("data-botdar", "1");
    }

    window.history.pushState(null, "", "/r/woodworking/comments/1k9x2ab/walnut/?sort=new");
    document.body.append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);

    expect(copiedReplies(adapter, "bright_sail_8803")).toBe(2);
    stop();
    window.history.back();
  });
});
