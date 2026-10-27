// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/"}

import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { Scorer } from "@/src/core/pipeline";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/src/core/settings";
import { defaultWeights } from "@/src/core/scoring/weights";
import type { PartialSignals, SignalSource, Verdict } from "@/src/core/types";
import { createRedditAdapter, redditOnSight } from "@/src/platforms/reddit/adapter";
import { IDLE_TIMEOUT_MS } from "@/src/platforms/reddit/observer";
import type { OnSightRuntime } from "@/src/platforms/onSightWire";
import { wireOnSight } from "@/src/platforms/onSightWire";
import { BADGE_ELEMENT_NAME } from "@/src/ui/mount";

/** These tests count platform calls under fake timers; storage hashing is covered in the core tests. */
const onSightSettings = { ...defaultSettings, persistLookups: false };
import { TtlLruCache } from "@/src/core/cache";
import { hydrateDeclarativeShadowRoots, loadRedditFixture } from "./fixtures";

/** Unknown until Tier 2 delivers, then typical: the shape of a live Reddit author. */
const scorer: Scorer = (_features, signals, sourcesAvailable) => {
  const verdict: Verdict = {
    tier: signals.provenance.linkKarma === 2 ? "typical" : "unknown",
    probability: 0.05,
    logOdds: -3,
    evidence: [],
    reasons: [],
    confidence: sourcesAvailable.length / 3,
    caveat: "",
    sourcesUsed: [0],
    sourcesMissing: [2],
    lowConfidence: false,
    policyVersion: 1,
    computedAt: 0,
  };
  return verdict;
};

interface Harness {
  dispose: () => void;
  resolve: ReturnType<typeof vi.fn>;
  finish: (partial: PartialSignals | null) => void;
  /** Swaps the runtime's Tier 2 switch and announces a settings change, as the options page would. */
  setTier2: (t2: boolean) => Promise<void>;
}

interface WireOptions {
  /** Top-level comments by this many distinct authors instead of the recorded thread. */
  authors?: number;
  rateLimitPerMinute?: number;
}

/** One top-level comment per author, in the recorded thread's markup shape. */
function threadOf(authorCount: number): void {
  const comments: string = Array.from({ length: authorCount }, (_unused, index) => {
    const author = `Author_${index}`;
    return `<shreddit-comment author="${author}" thingid="t1_c${index}" depth="0">
      <template shadowrootmode="open"><slot name="commentMeta"></slot></template>
      <div slot="commentMeta"><a href="/user/${author}/" class="author-name">${author}</a></div>
    </shreddit-comment>`;
  }).join("");
  document.body.innerHTML = `<shreddit-comment-tree>${comments}</shreddit-comment-tree>`;
  hydrateDeclarativeShadowRoots(document.body);
}

/** The wiring under test, disposed after each test even when an assertion stopped it early. */
let disposeCurrent: (() => void) | undefined;

async function wire(initialT2: boolean, options: WireOptions = {}): Promise<Harness> {
  if (options.authors === undefined) loadRedditFixture("comments.html");
  else threadOf(options.authors);
  let t2: boolean = initialT2;
  await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: onSightSettings });
  const waiting: Array<(partial: PartialSignals | null) => void> = [];
  const resolve = vi.fn(
    () => new Promise<PartialSignals | null>((resolvePartial) => waiting.push(resolvePartial)),
  );
  const source: SignalSource = { id: "fake", platform: "reddit", tier: 2, kind: "active", resolve };
  const ctx = {
    options: {},
    onInvalidated: () => () => undefined,
    addEventListener: (target: EventTarget, type: string, handler: EventListener) =>
      target.addEventListener(type, handler),
  } as unknown as ContentScriptContext;
  const loadRuntime = async (): Promise<OnSightRuntime> => ({
    config: {
      platform: "reddit",
      enabled: true,
      tiers: { t1: false, t2 },
      rateLimitPerMinute: options.rateLimitPerMinute ?? 30,
      policyVersion: 1,
    },
    weights: defaultWeights.reddit,
    settings: onSightSettings,
  });
  const dispose: () => void = await wireOnSight(ctx, "", redditOnSight, {
    adapter: createRedditAdapter({ sources: [source] }),
    loadRuntime,
    scorer: () => scorer,
    openSettings: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
  await vi.waitFor(() => expect(badgeButtons().length).toBeGreaterThan(0));
  const finish = (partial: PartialSignals | null): void => {
    waiting.splice(0).forEach((resolvePartial) => resolvePartial(partial));
  };
  const setTier2 = async (next: boolean): Promise<void> => {
    t2 = next;
    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { ...onSightSettings, conservativeMode: !next },
    });
    await vi.advanceTimersByTimeAsync(0);
  };
  disposeCurrent = dispose;
  return { dispose, resolve, finish, setTier2 };
}

function badgeButtons(): HTMLButtonElement[] {
  const hosts: Element[] = [...document.querySelectorAll(BADGE_ELEMENT_NAME)];
  for (const post of document.querySelectorAll("shreddit-post, shreddit-comment")) {
    hosts.push(...(post.shadowRoot?.querySelectorAll(BADGE_ELEMENT_NAME) ?? []));
  }
  return hosts.flatMap((host) => host.shadowRoot?.querySelector("button") ?? []);
}

describe("wireOnSight on Reddit on-sight lookups", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    disposeCurrent?.();
    disposeCurrent = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("looks each author up once when their posts come into view, showing Checking until it settles", async () => {
    const harness: Harness = await wire(true);
    // Four comments by three authors: one lookup each, no hover needed.
    expect(harness.resolve).toHaveBeenCalledTimes(3);
    expect(badgeButtons()).toHaveLength(4);
    for (const button of badgeButtons()) {
      expect(button.className).toContain("bd-badge--loading");
      // Dozens of badges pulsing at once drop frames; only the one under the pointer pulses.
      expect(button.className).toContain("bd-badge--loading-still");
      expect(button.getAttribute("aria-label")).toBe("Checking");
    }
    const [hovered] = badgeButtons();
    hovered?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    expect(badgeButtons()[0]?.className).not.toContain("bd-badge--loading-still");
    hovered?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
    expect(badgeButtons()[0]?.className).toContain("bd-badge--loading-still");

    harness.finish({ linkKarma: 2 });
    await vi.waitFor(() =>
      expect(badgeButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
        "Likely human",
        "Likely human",
        "Likely human",
        "Likely human",
      ]),
    );
    expect(badgeButtons().some((button) => button.className.includes("bd-badge--loading"))).toBe(
      false,
    );
    harness.dispose();
  });

  it("falls to No read when the lookup returns nothing", async () => {
    const harness: Harness = await wire(true);
    harness.finish(null);
    await vi.waitFor(() =>
      expect(
        badgeButtons().every((button) => button.getAttribute("aria-label") === "No read"),
      ).toBe(true),
    );
    harness.dispose();
  });

  it("lets a hovered author still waiting in the queue go next", async () => {
    // Twelve authors and a burst of ten: Author_10 and Author_11 wait, one token per ten seconds.
    const harness: Harness = await wire(true, { authors: 12, rateLimitPerMinute: 6 });
    expect(harness.resolve).toHaveBeenCalledTimes(10);
    const lastButton: HTMLButtonElement | undefined = badgeButtons()[11];
    lastButton?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.resolve).toHaveBeenCalledTimes(11);
    expect(harness.resolve.mock.calls[10]?.[0]).toMatchObject({ handle: "author_11" });
    harness.dispose();
  });

  it("looks up the authors already on screen when Tier 2 comes back on", async () => {
    const harness: Harness = await wire(false);
    expect(harness.resolve).not.toHaveBeenCalled();
    await harness.setTier2(true);
    await vi.waitFor(() => expect(harness.resolve).toHaveBeenCalledTimes(3));
    for (const button of badgeButtons()) {
      expect(button.getAttribute("aria-label")).toBe("Checking");
    }
    harness.dispose();
  });

  it("draws the cached read of an author the cache already holds", async () => {
    vi.spyOn(TtlLruCache.prototype, "get").mockReturnValue({ linkKarma: 5 });
    const harness: Harness = await wire(true);
    expect(harness.resolve).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(badgeButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
        "Likely human",
        "Likely human",
        "Likely human",
        "Likely human",
      ]),
    );
    harness.dispose();
  });

  it("makes no request while Tier 2 is off and draws a paused No read", async () => {
    const harness: Harness = await wire(false);
    expect(harness.resolve).not.toHaveBeenCalled();
    for (const button of badgeButtons()) {
      expect(button.getAttribute("aria-label")).toBe("No read");
      expect(button.className).toContain("bd-badge--paused");
      expect(button.className).not.toContain("bd-badge--loading");
    }
    harness.dispose();
  });
});
