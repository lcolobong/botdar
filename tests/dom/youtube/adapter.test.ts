// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.youtube.com/watch?v=fs4k4h1v9go"}

import { IDLE_TIMEOUT_MS } from "@/src/core/idleSlices";
import type { AccountSignals, Feature, PlatformAdapter } from "@/src/core/types";
import { createYouTubeAdapter } from "@/src/platforms/youtube/adapter";
import { commentMarkup } from "./fixtures";

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const MINUTE = 60_000;
const COPIED_TEXT =
  "Stock up now, the shops will be empty by Friday and prices are going up again.";

const signalsOf = (handle: string): AccountSignals => ({
  ref: { platform: "youtube", handle },
  provenance: {},
  tiersDelivered: [0],
  observedAt: NOW,
});

const copiedReplies = (adapter: PlatformAdapter, handle: string): Feature | undefined =>
  adapter
    .toFeatures(signalsOf(handle))
    .find((feature) => feature.id === "thread.nearDuplicateReply");

/** Lets the MutationObserver deliver, then runs the coalesced pass. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
}

describe("the YouTube adapter's thread index", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dates a comment loaded later from when it was read, so a later copy counts as a copy", async () => {
    document.body.innerHTML = `<ytd-comments id="comments"><div id="contents">${commentMarkup({
      handle: "maria_reads40",
      commentId: "UgwOriginalComment000000AaABAg",
      age: "5 minutes ago",
      text: COPIED_TEXT,
    })}</div></ytd-comments>`;
    const adapter: PlatformAdapter = createYouTubeAdapter({ sources: [] });
    const stop: () => void = adapter.observeFeed(
      () => undefined,
      () => undefined,
    );
    await settle();
    // Twenty minutes into the visit a continuation loads a copy that YouTube also calls "5 minutes
    // ago": it was posted fifteen minutes after the original, and must be dated so.
    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    document.querySelector("#contents")?.insertAdjacentHTML(
      "beforeend",
      commentMarkup({
        handle: "lena_runs12",
        commentId: "UgwCopiedComment00000000AaABAg",
        age: "5 minutes ago",
        text: COPIED_TEXT,
      }),
    );
    await settle();
    expect(copiedReplies(adapter, "lena_runs12")?.value).toBe(1);
    expect(copiedReplies(adapter, "maria_reads40")?.value).toBe(0);
    stop();
  });
});
