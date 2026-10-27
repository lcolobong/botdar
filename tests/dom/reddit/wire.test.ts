// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/"}

import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { listFeedback } from "@/src/core/feedback";
import type { Scorer } from "@/src/core/pipeline";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import type {
  EffectivePlatformConfig,
  PartialSignals,
  SignalSource,
  Verdict,
  VerdictTier,
} from "@/src/core/types";
import { createRedditAdapter, redditOnSight } from "@/src/platforms/reddit/adapter";
import { IDLE_TIMEOUT_MS } from "@/src/platforms/reddit/observer";
import type { OnSightRuntime } from "@/src/platforms/onSightWire";
import { wireOnSight } from "@/src/platforms/onSightWire";
import { defaultWeights } from "@/src/core/scoring/weights";
import { BADGE_ELEMENT_NAME, CARD_ELEMENT_NAME } from "@/src/ui/mount";
import { adoptedCssOf } from "../adoptedCss";
import { fakeReason } from "../../fakeReasons";
import { loadRedditFixture } from "./fixtures";

const SHADOW_CSS = ":host { --botdar-test: reddit; }";

const TIER_BY_HANDLE: Record<string, VerdictTier> = {
  quiet_lantern_4821: "typical",
  brisk_falcon_2210: "many",
  mossy_teapot: "some",
  deal_scout_90210: "many",
};

const fakeScorer: Scorer = (features, signals, sourcesAvailable) => {
  const tier: VerdictTier =
    signals.declaredAutomated === true
      ? "declared"
      : (TIER_BY_HANDLE[signals.ref.handle] ?? "unknown");
  const verdict: Verdict = {
    tier,
    probability: 0.5,
    logOdds: 0,
    evidence: [
      {
        feature: "reddit.generatedName",
        contribution: 0.4,
        group: "handle",
        tier: 0,
        reason: "Name",
      },
    ],
    reasons: [fakeReason("Name"), fakeReason(`Sources ${sourcesAvailable.join("")}`)],
    confidence: 0.5,
    caveat: "This can be wrong.",
    sourcesUsed: [0],
    sourcesMissing: [2],
    lowConfidence: features.length === 0,
    policyVersion: 1,
    computedAt: 0,
  };
  return verdict;
};

const config = (tiers: { t1: boolean; t2: boolean }): EffectivePlatformConfig => ({
  platform: "reddit",
  enabled: true,
  tiers,
  rateLimitPerMinute: 30,
  policyVersion: 1,
});

interface Harness {
  dispose: () => void;
  resolve: ReturnType<typeof vi.fn>;
  invalidate: () => void;
}

async function wire(
  fixture: string,
  overrides: { settings?: Partial<Settings>; t2?: boolean } = {},
): Promise<Harness> {
  loadRedditFixture(fixture);
  // Likely human off unless a test asks, so the typical author draws nothing by default here.
  const settings: Settings = {
    ...defaultSettings,
    persistLookups: false,
    showLikelyHuman: false,
    ...overrides.settings,
  };
  await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
  const resolve = vi.fn(async (): Promise<PartialSignals | null> => ({ linkKarma: 5 }));
  const source: SignalSource = {
    id: "fake",
    platform: "reddit",
    tier: 2,
    kind: "active",
    resolve,
  };
  const invalidations: Array<() => void> = [];
  const ctx = {
    options: {},
    onInvalidated: (callback: () => void) => {
      invalidations.push(callback);
      return () => undefined;
    },
    addEventListener: (target: EventTarget, type: string, handler: EventListener) =>
      target.addEventListener(type, handler),
  } as unknown as ContentScriptContext;
  const loadRuntime = async (): Promise<OnSightRuntime> => ({
    config: config({ t1: false, t2: overrides.t2 ?? true }),
    weights: defaultWeights.reddit,
    settings: (await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY))[
      SETTINGS_STORAGE_KEY
    ] as Settings,
  });
  const dispose: () => void = await wireOnSight(ctx, SHADOW_CSS, redditOnSight, {
    adapter: createRedditAdapter({ sources: [source] }),
    loadRuntime,
    scorer: () => fakeScorer,
    openSettings: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
  await vi.waitFor(() => expect(badges().length).toBeGreaterThan(0));
  return { dispose, resolve, invalidate: () => invalidations.forEach((callback) => callback()) };
}

/** Badge hosts in light DOM and inside the posts' own shadow roots. */
function badges(): HTMLElement[] {
  const hosts: HTMLElement[] = [...document.querySelectorAll<HTMLElement>(BADGE_ELEMENT_NAME)];
  for (const post of document.querySelectorAll("shreddit-post, shreddit-comment")) {
    hosts.push(...(post.shadowRoot?.querySelectorAll<HTMLElement>(BADGE_ELEMENT_NAME) ?? []));
  }
  return hosts;
}

/** The fixture writes author links relative or absolute, as the live site does; match on the path. */
function badgeFor(handle: string): HTMLElement | undefined {
  return badges().find((host) =>
    (host.previousElementSibling?.getAttribute("href") ?? "")
      .toLowerCase()
      .endsWith(`/user/${handle}/`),
  );
}

function buttonOf(host: HTMLElement | undefined): HTMLButtonElement {
  const button: HTMLButtonElement | null | undefined = host?.shadowRoot?.querySelector("button");
  if (button === null || button === undefined) throw new Error("badge button missing");
  return button;
}

function card(): HTMLElement {
  const host: HTMLElement | null = document.querySelector(CARD_ELEMENT_NAME);
  if (host === null) throw new Error("card missing");
  return host;
}

describe("wireOnSight on Reddit", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts badges only for drawn tiers and marks their posts", async () => {
    const harness: Harness = await wire("feed.html");

    expect(badges()).toHaveLength(1);
    expect(badgeFor("brisk_falcon_2210")).toBeDefined();
    expect(badgeFor("quiet_lantern_4821")).toBeUndefined();
    expect(buttonOf(badgeFor("brisk_falcon_2210")).getAttribute("aria-label")).toBe("Declared bot");
    expect(buttonOf(badgeFor("brisk_falcon_2210")).className).toContain("bd-badge--reddit-post");
    expect(
      [...document.querySelectorAll("shreddit-post")].map((post) =>
        post.hasAttribute("data-botdar"),
      ),
    ).toEqual([false, true]);
    expect(document.querySelectorAll(CARD_ELEMENT_NAME)).toHaveLength(1);
    harness.dispose();
  });

  it("writes the bundled stylesheet into the badge and card shadow roots", async () => {
    const harness: Harness = await wire("feed.html");
    const styleOf = (host: HTMLElement | undefined): string => adoptedCssOf(host);

    expect(styleOf(badgeFor("brisk_falcon_2210"))).toContain(SHADOW_CSS);
    expect(styleOf(card())).toContain(SHADOW_CSS);
    harness.dispose();
  });

  it("draws Likely human with the default settings, and unmounts it when it is turned off", async () => {
    const harness: Harness = await wire("feed.html", {
      settings: { ...defaultSettings, persistLookups: false },
    });
    expect(badges()).toHaveLength(2);
    expect(buttonOf(badgeFor("quiet_lantern_4821")).textContent).toContain("Likely human");

    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { ...defaultSettings, persistLookups: false, showLikelyHuman: false },
    });
    await vi.waitFor(() => expect(badges()).toHaveLength(1));

    expect(badgeFor("quiet_lantern_4821")).toBeUndefined();
    harness.dispose();
  });

  it("closes an open Likely human card when Likely human is turned off", async () => {
    const harness: Harness = await wire("feed.html", {
      settings: { ...defaultSettings, persistLookups: false },
    });
    buttonOf(badgeFor("quiet_lantern_4821")).dispatchEvent(
      new MouseEvent("mouseenter", { bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(150);
    expect(card().style.getPropertyValue("--botdar-display")).toBe("block");

    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { ...defaultSettings, persistLookups: false, showLikelyHuman: false },
    });
    await vi.waitFor(() => expect(card().style.getPropertyValue("--botdar-display")).toBe("none"));
    harness.dispose();
  });

  it("renders comments glyph-only by default and with labels when asked", async () => {
    const harness: Harness = await wire("comments.html");
    const some: HTMLButtonElement = buttonOf(badgeFor("mossy_teapot"));
    expect(badges()).toHaveLength(2);
    expect(some.className).toContain("bd-badge--reddit-comment");
    expect(some.className).toContain("bd-badge--glyph-only");
    expect(some.textContent).not.toContain("Unsure");
    expect(some.getAttribute("aria-label")).toBe("Unsure");
    harness.dispose();

    const labelled: Harness = await wire("comments.html", {
      settings: { redditCommentLabels: "label" },
    });
    const withLabel: HTMLButtonElement = buttonOf(badgeFor("deal_scout_90210"));
    expect(withLabel.className).not.toContain("bd-badge--glyph-only");
    expect(withLabel.textContent).toContain("Likely bot");
    labelled.dispose();
  });

  it("dashes the badge while lookups are paused", async () => {
    const harness: Harness = await wire("comments.html", { t2: false });
    expect(buttonOf(badgeFor("mossy_teapot")).className).toContain("bd-badge--paused");
    harness.dispose();
  });

  it("opens the card on hover, serves the on-sight lookup and records feedback", async () => {
    const harness: Harness = await wire("comments.html");
    const button: HTMLButtonElement = buttonOf(badgeFor("deal_scout_90210"));
    const lookupsOnSight: number = harness.resolve.mock.calls.length;

    button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);

    expect(card().style.getPropertyValue("--botdar-display")).toBe("block");
    expect(card().shadowRoot?.textContent).toContain("u/deal_scout_90210");
    expect(card().shadowRoot?.textContent).toContain("Name");
    expect(harness.resolve).toHaveBeenCalledTimes(lookupsOnSight);
    await vi.waitFor(() =>
      expect(card().shadowRoot?.querySelector('[aria-busy="true"]')).toBeNull(),
    );

    const feedback: HTMLButtonElement | null | undefined = card().shadowRoot?.querySelector(
      'button[aria-pressed="false"]',
    );
    feedback?.click();
    await vi.waitFor(async () => expect(await listFeedback()).toHaveLength(1));
    expect((await listFeedback())[0]).toMatchObject({
      platform: "reddit",
      handle: "deal_scout_90210",
      tier: "many",
    });

    button.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
    expect(card().style.getPropertyValue("--botdar-display")).toBe("none");
    harness.dispose();
  });

  it("skips the lookup when Tier 2 is off", async () => {
    const harness: Harness = await wire("comments.html", { t2: false });
    buttonOf(badgeFor("mossy_teapot")).dispatchEvent(new MouseEvent("mouseenter"));
    await vi.advanceTimersByTimeAsync(150);

    expect(card().style.getPropertyValue("--botdar-display")).toBe("block");
    expect(harness.resolve).not.toHaveBeenCalled();
    harness.dispose();
  });

  it("removes every badge and the card when the script is invalidated", async () => {
    const harness: Harness = await wire("comments.html");
    harness.invalidate();

    expect(badges()).toHaveLength(0);
    expect(document.querySelector(CARD_ELEMENT_NAME)).toBeNull();
    expect(document.querySelector("[data-botdar]")).toBeNull();
  });
});
