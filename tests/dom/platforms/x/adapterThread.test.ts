// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/city_paper/status/2115005580702646272"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountSignals, Feature, PlatformAdapter } from "@/src/core/types";
import { createXAdapter } from "@/src/platforms/x/adapter";
import { PASS_DELAY_MS } from "@/src/platforms/x/observer";
import { QueryIdRegistry } from "@/src/platforms/x/queryIds";

function signalsOf(handle: string): AccountSignals {
  return { ref: { platform: "x", handle }, provenance: {}, tiersDelivered: [0], observedAt: 0 };
}

function copiedReplies(adapter: PlatformAdapter, handle: string): Feature["value"] | undefined {
  return adapter
    .toFeatures(signalsOf(handle))
    .find((feature) => feature.id === "thread.nearDuplicateReply")?.value;
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
});
