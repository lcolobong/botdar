// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/"}

import type { AccountSignals, PlatformAdapter, PostRef } from "@/src/core/types";
import { createRedditAdapter, matchesReddit, redditAdapter } from "@/src/platforms/reddit/adapter";
import { IDLE_TIMEOUT_MS } from "@/src/platforms/reddit/observer";
import { ABOUT_JSON_SOURCE_ID } from "@/src/platforms/reddit/sources/aboutJson";
import { loadRedditFixture } from "./fixtures";

async function settle(): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
}

describe("redditAdapter", () => {
  it("matches both Reddit hosts over https only", () => {
    expect(matchesReddit(new URL("https://www.reddit.com/r/woodworking/"))).toBe(true);
    expect(matchesReddit(new URL("https://old.reddit.com/"))).toBe(true);
    expect(matchesReddit(new URL("https://reddit.com/"))).toBe(false);
    expect(matchesReddit(new URL("https://www.reddit.com.evil.example/"))).toBe(false);
    expect(matchesReddit(new URL("http://www.reddit.com/"))).toBe(false);
    expect(redditAdapter.matches).toBe(matchesReddit);
  });

  it("declares the id, the post density default and the about.json source as the only source", () => {
    expect(redditAdapter.id).toBe("reddit");
    expect(redditAdapter.badgeDensity).toBe("reddit-post");
    expect(redditAdapter.sources.map((source) => [source.id, source.tier, source.kind])).toEqual([
      [ABOUT_JSON_SOURCE_ID, 2, "active"],
    ]);
  });

  it("maps the feature table from features.ts", () => {
    const signals: AccountSignals = {
      ref: { platform: "reddit", handle: "brisk_falcon_2210" },
      displayName: "Brisk_Falcon_2210",
      hasDefaultAvatar: true,
      provenance: { displayName: 0, hasDefaultAvatar: 0 },
      observedAt: Date.now(),
    };
    expect(redditAdapter.toFeatures(signals).map((feature) => [feature.id, feature.value])).toEqual(
      [
        ["reddit.generatedName", true],
        ["reddit.noAvatar", true],
      ],
    );
  });

  describe("observeFeed", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      document.body.innerHTML = "";
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("tags each PostRef with its density and extracts Tier 0 from it", async () => {
      loadRedditFixture("comments.html");
      const onPost = vi.fn<(post: PostRef) => void>();
      const stop: () => void = redditAdapter.observeFeed(onPost, () => undefined);

      await settle();

      const posts: PostRef[] = onPost.mock.calls.map(([post]) => post);
      expect(posts.map((post) => [post.ref.handle, post.density])).toEqual([
        ["quiet_lantern_4821", "reddit-post"],
        ["mossy_teapot", "reddit-comment"],
        ["quiet_lantern_4821", "reddit-comment"],
        ["deal_scout_90210", "reddit-comment"],
      ]);
      const scout: PostRef | undefined = posts[3];
      if (scout === undefined) throw new Error("fixture missing");
      expect(redditAdapter.extractDomSignals(scout)).toEqual({
        displayName: "Deal_Scout_90210",
        hasDefaultAvatar: true,
      });
      stop();
    });

    it("forwards route changes and accepts replacement sources", async () => {
      const onRouteChange = vi.fn();
      const adapter: PlatformAdapter = createRedditAdapter({ sources: [], onRouteChange });
      expect(adapter.sources).toEqual([]);
      const stop: () => void = adapter.observeFeed(
        () => undefined,
        () => undefined,
      );
      await settle();

      window.history.pushState(null, "", "/r/dailydeals/");
      document.body.append(document.createElement("div"));
      await settle();

      expect(onRouteChange).toHaveBeenCalledWith("https://www.reddit.com/r/dailydeals/");
      stop();
      window.history.replaceState(null, "", "/");
    });
  });
});
