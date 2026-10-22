// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}

import type { PlatformAdapter, PostRef } from "@/src/core/types";
import { createXAdapter } from "@/src/platforms/x/adapter";
import { toPostRef } from "@/src/platforms/x/dom";
import { PASS_DELAY_MS } from "@/src/platforms/x/observer";
import { QueryIdRegistry } from "@/src/platforms/x/queryIds";
import { loadTimeline, timelineArticles } from "./timelineFixture";

describe("createXAdapter", () => {
  const adapter: PlatformAdapter = createXAdapter({ registry: new QueryIdRegistry() });

  it("matches X hosts only", () => {
    for (const host of ["x.com", "www.x.com", "twitter.com", "mobile.twitter.com"]) {
      expect(adapter.matches(new URL(`https://${host}/home`))).toBe(true);
    }
    expect(adapter.matches(new URL("https://xx.com/home"))).toBe(false);
    expect(adapter.matches(new URL("https://bsky.app/"))).toBe(false);
  });

  it("assembles both tiers of sources and the X badge density", () => {
    expect(adapter.id).toBe("x");
    expect(adapter.badgeDensity).toBe("x");
    expect(adapter.sources.map((source) => [source.tier, source.kind])).toEqual([
      [1, "passive"],
      [2, "active"],
    ]);
  });

  it("extracts Tier 0 signals and the handle features for a fixture post", () => {
    loadTimeline();
    const article: Element | undefined = timelineArticles()[1];
    const post: PostRef | undefined = article === undefined ? undefined : toPostRef(article);
    if (post === undefined) throw new Error("fixture post missing");
    expect(adapter.extractDomSignals(post)).toEqual({
      displayName: "Kai",
      hasDefaultAvatar: true,
      declaredAutomated: true,
    });
    const ids: string[] = adapter
      .toFeatures({ ref: post.ref, provenance: {}, observedAt: 0 })
      .map((feature) => feature.id);
    expect(ids).toEqual(["x.handleNameDigits", "x.handleTrailingDigits"]);
  });

  it("observes the feed through the shared observer and reports route changes", async () => {
    vi.useFakeTimers();
    try {
      const onRouteChange = vi.fn();
      const routed: PlatformAdapter = createXAdapter({
        registry: new QueryIdRegistry(),
        onRouteChange,
      });
      const onPost = vi.fn();
      const stop: () => void = routed.observeFeed(onPost, () => undefined);
      loadTimeline();
      await vi.advanceTimersByTimeAsync(PASS_DELAY_MS);
      expect(onPost).toHaveBeenCalledTimes(3);
      history.pushState(null, "", "/explore");
      document.body.append(document.createElement("div"));
      await vi.advanceTimersByTimeAsync(PASS_DELAY_MS);
      expect(onRouteChange).toHaveBeenCalledWith("https://x.com/explore");
      stop();
      history.replaceState(null, "", "/home");
    } finally {
      vi.useRealTimers();
    }
  });
});
