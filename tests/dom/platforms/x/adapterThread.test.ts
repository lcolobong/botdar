// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/city_paper/status/2115005580702646272"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountSignals, Feature, PlatformAdapter } from "@/src/core/types";
import { createXAdapter } from "@/src/platforms/x/adapter";
import { PASS_DELAY_MS } from "@/src/platforms/x/observer";
import { X_GRAPHQL_RELAY_KIND } from "@/src/platforms/x/graphqlRoutes";
import { QueryIdRegistry } from "@/src/platforms/x/queryIds";

function signalsOf(handle: string): AccountSignals {
  return { ref: { platform: "x", handle }, provenance: {}, tiersDelivered: [0], observedAt: 0 };
}

function copiedReplies(adapter: PlatformAdapter, handle: string): Feature["value"] | undefined {
  return adapter
    .toFeatures(signalsOf(handle))
    .find((feature) => feature.id === "thread.nearDuplicateReply")?.value;
}

function sharedDomains(adapter: PlatformAdapter, handle: string): Feature | undefined {
  return adapter
    .toFeatures(signalsOf(handle))
    .find((feature) => feature.id === "thread.sharedRareDomain");
}

/** A conversation body with one post, by status id, linking `expandedUrl` through t.co. */
function conversationPost(statusId: string, screenName: string, expandedUrl: string): unknown {
  return {
    rest_id: statusId,
    core: {
      user_results: {
        result: {
          __typename: "User",
          rest_id: `9${statusId.slice(1)}`,
          legacy: { screen_name: screenName, created_at: "Mon Mar 02 11:05:00 +0000 2015" },
        },
      },
    },
    legacy: {
      full_text: "https://t.co/abc",
      entities: { urls: [{ url: "https://t.co/abc", expanded_url: expandedUrl }] },
    },
  };
}

function relayConversation(posts: unknown[]): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        __botdar: 1,
        v: 1,
        kind: X_GRAPHQL_RELAY_KIND,
        op: "TweetDetail",
        queryId: "QueryId_000000000001",
        body: { data: { posts } },
      },
      origin: location.origin,
      source: window,
    }),
  );
}

describe("createXAdapter on a thread page", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("indexes every discovered reply and forgets them when the page navigates", async () => {
    const adapter: PlatformAdapter = createXAdapter({ registry: new QueryIdRegistry() });
    const changed = vi.fn();
    adapter.onEvidenceChanged?.(changed);
    const stop: () => void = adapter.observeFeed(
      () => undefined,
      () => undefined,
    );
    const html: string = readFileSync(
      join(process.cwd(), "tests/fixtures/x/html/thread.html"),
      "utf8",
    );
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? html;
    await vi.advanceTimersByTimeAsync(PASS_DELAY_MS);

    expect(copiedReplies(adapter, "maria_dev")).toBe(0);
    expect(copiedReplies(adapter, "kai09127364")).toBe(1);
    expect(copiedReplies(adapter, "mila48213907")).toBe(2);
    expect(copiedReplies(adapter, "city_paper")).toBeUndefined();

    history.pushState(null, "", "/home");
    document.body.append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(PASS_DELAY_MS);

    expect(changed).toHaveBeenCalledWith(["kai09127364", "mila48213907"]);
    expect(copiedReplies(adapter, "mila48213907")).toBeUndefined();
    stop();
  });

  it("scores links expanded by Tier 1 as Tier 1 evidence, keyed by status id", async () => {
    history.pushState(null, "", "/city_paper/status/2115005580702646272");
    const adapter: PlatformAdapter = createXAdapter({ registry: new QueryIdRegistry() });
    const passive = adapter.sources.find((source) => source.tier === 1);
    const stopSource: () => void = passive?.start?.(() => undefined) ?? (() => undefined);
    const stop: () => void = adapter.observeFeed(
      () => undefined,
      () => undefined,
    );
    const html: string = readFileSync(
      join(process.cwd(), "tests/fixtures/x/html/thread.html"),
      "utf8",
    );
    document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? html;
    await vi.advanceTimersByTimeAsync(PASS_DELAY_MS);
    const statusIdOf = (handle: string): string =>
      /\/status\/(\d+)/.exec(
        document.querySelector(`a[href^="/${handle}/status/"]`)?.getAttribute("href") ?? "",
      )?.[1] ?? "";

    relayConversation(
      ["maria_dev", "kai09127364", "mila48213907"].map((handle) =>
        conversationPost(statusIdOf(handle), handle, "https://www.example-gazette.net/a"),
      ),
    );

    expect(sharedDomains(adapter, "mila48213907")).toMatchObject({ value: 2, tier: 1 });
    expect(sharedDomains(adapter, "city_paper")).toBeUndefined();

    // The root's links arrive under the status id the page names: its site stops counting.
    relayConversation([
      conversationPost(
        "2115005580702646272",
        "city_paper",
        "https://example-gazette.net/the-story",
      ),
    ]);
    expect(sharedDomains(adapter, "mila48213907")).toBeUndefined();
    stop();
    stopSource();
  });
});
