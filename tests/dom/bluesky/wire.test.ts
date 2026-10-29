// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://bsky.app/"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import type { FeedbackEntry, FeedbackInput } from "@/src/core/feedback";
import type { PlatformWeights } from "@/src/core/scoring/types";
import { defaultSettings } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import type {
  AccountSignals,
  EffectivePlatformConfig,
  Feature,
  PartialSignals,
  PlatformAdapter,
  SignalSource,
  Verdict,
} from "@/src/core/types";
import { BADGE_ELEMENT_NAME, CARD_ELEMENT_NAME } from "@/src/ui/mount";
import { adoptedCssOf } from "../adoptedCss";
import { fakeReason } from "../../fakeReasons";
import { createBlueskyAdapter } from "@/src/platforms/bluesky/adapter";
import { wireBluesky } from "@/src/platforms/bluesky/wire";
import type { WireDependencies } from "@/src/platforms/bluesky/wire";

const SHADOW_CSS = ":host { --botdar-test: bluesky; }";

const FEED_HTML: string = readFileSync(
  join(import.meta.dirname, "..", "..", "fixtures", "bluesky", "html", "feed.html"),
  "utf8",
);

const config = (overrides: Partial<EffectivePlatformConfig> = {}): EffectivePlatformConfig => ({
  platform: "bluesky",
  enabled: true,
  tiers: { t1: true, t2: true },
  rateLimitPerMinute: 30,
  policyVersion: 7,
  ...overrides,
});

/** A scorer keyed on what Tier 0 and the fake Tier 2 deliver, so verdicts are predictable. */
const fakeScore = (
  features: Feature[],
  signals: AccountSignals,
  _weights: PlatformWeights,
  options: { policyVersion: number },
): Verdict => {
  const tier: Verdict["tier"] =
    signals.declaredAutomated === true
      ? "declared"
      : signals.ref.handle.startsWith("alice")
        ? signals.followers === undefined
          ? "some"
          : "many"
        : "typical";
  return {
    tier,
    probability: 0.5,
    logOdds: 0,
    evidence: features.map((feature) => ({
      feature: feature.id,
      contribution: 1,
      group: feature.group,
      tier: feature.tier,
      reason: `reason:${feature.id}`,
    })),
    reasons: features.map((feature) => fakeReason(`reason:${feature.id}`, feature.tier)),
    confidence: 0.5,
    confidenceNote: "Extra lookups not run yet",
    caveat: "This can be wrong: fixture.",
    sourcesUsed: [0],
    sourcesMissing: [1, 2],
    lowConfidence: signals.followers === undefined,
    policyVersion: options.policyVersion,
    computedAt: 1,
  };
};

interface Harness {
  deps: WireDependencies;
  resolve: ReturnType<typeof vi.fn>;
  recordFeedback: ReturnType<typeof vi.fn>;
  removeFeedback: ReturnType<typeof vi.fn>;
  openOptionsPage: ReturnType<typeof vi.fn>;
  emitConfig: (next: EffectivePlatformConfig) => void;
  emitSettings: (next: Settings) => void;
  configNow: EffectivePlatformConfig;
}

/** Likely human off, so the fixture's typical authors draw nothing unless a test turns it on. */
const QUIET_SETTINGS: Settings = {
  ...defaultSettings,
  showLikelyHuman: false,
  persistLookups: false,
};

const makeHarness = (
  initial: EffectivePlatformConfig = config(),
  settings: Settings = QUIET_SETTINGS,
): Harness => {
  const resolve = vi.fn(async (): Promise<PartialSignals | null> => ({ followers: 42 }));
  const active: SignalSource = {
    id: "fake.active",
    platform: "bluesky",
    tier: 2,
    kind: "active",
    resolve,
  };
  const base: PlatformAdapter = createBlueskyAdapter();
  const adapter: PlatformAdapter = {
    ...base,
    sources: [active],
    toFeatures: (signals) =>
      (["displayName", "hasDefaultAvatar", "followers"] as const)
        .filter((field) => signals[field] !== undefined)
        .map((field) => ({
          id: `bsky.${field}`,
          value: true,
          group: "profile",
          tier: signals.provenance[field] ?? 0,
        })),
  };
  let configListener: (next: EffectivePlatformConfig) => void = () => undefined;
  let settingsListener: (next: Settings) => void = () => undefined;
  const recordFeedback = vi.fn(async (input: FeedbackInput): Promise<FeedbackEntry> => ({
    ...input,
    id: "fb-1",
    recordedAt: 2,
  }));
  const removeFeedback = vi.fn(async (): Promise<boolean> => true);
  const openOptionsPage = vi.fn();
  const harness: Harness = {
    resolve,
    recordFeedback,
    removeFeedback,
    openOptionsPage,
    configNow: initial,
    emitConfig: (next) => {
      harness.configNow = next;
      configListener(next);
    },
    emitSettings: (next) => settingsListener(next),
    deps: {
      adapter,
      score: fakeScore,
      loadConfig: async () => harness.configNow,
      loadWeights: async () => ({}) as unknown as PlatformWeights,
      loadSettings: async () => settings,
      onConfigChanged: (listener) => {
        configListener = listener;
        return () => undefined;
      },
      onSettingsChanged: (listener) => {
        settingsListener = listener;
        return () => undefined;
      },
      recordFeedback,
      removeFeedback,
      openOptionsPage,
    },
  };
  return harness;
};

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

/** The badge inside the post, which must sit right after an element showing the handle. */
const badgeAfter = (handle: string): HTMLElement | null => {
  const badge: HTMLElement | null = document.querySelector(
    `[data-testid$="-by-${handle}"] ${BADGE_ELEMENT_NAME}`,
  );
  if (badge !== null) {
    expect(badge.previousElementSibling?.textContent?.trim()).toBe(`@${handle}`);
  }
  return badge;
};

const badgeButton = (handle: string): HTMLButtonElement => {
  const button: HTMLButtonElement | null | undefined =
    badgeAfter(handle)?.shadowRoot?.querySelector("button");
  if (!button) throw new Error(`no badge button for ${handle}`);
  return button;
};

const cardHost = (): HTMLElement | null => document.body.querySelector(CARD_ELEMENT_NAME);

describe("wireBluesky", () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(window, { requestIdleCallback: undefined });
    document.documentElement.innerHTML = FEED_HTML;
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("mounts a badge after the handle of every post whose verdict draws one, and marks the post", async () => {
    const harness: Harness = makeHarness();
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();

    expect(badgeAfter("alice.example.com")).not.toBeNull();
    expect(badgeAfter("kai09127364.bsky.social")).not.toBeNull();
    expect(badgeAfter("newsroom.example.org")).toBeNull();
    expect(badgeButton("alice.example.com").getAttribute("aria-label")).toBe("Unsure");
    expect(badgeButton("alice.example.com").className).toContain("bd-badge--hollow");
    expect(badgeButton("kai09127364.bsky.social").getAttribute("aria-label")).toBe("Declared bot");
    expect(
      document.querySelectorAll(
        '[data-testid^="feedItem-by-"][data-botdar], [data-testid^="postThreadItem-by-"][data-botdar]',
      ),
    ).toHaveLength(5);
  });

  it("writes the bundled stylesheet into the badge and card shadow roots", async () => {
    const harness: Harness = makeHarness();
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();
    const styleOf = (host: Element | null): string => adoptedCssOf(host);

    expect(styleOf(badgeAfter("alice.example.com"))).toContain(SHADOW_CSS);

    // The card host is mounted up front; open the card to read its shadow root.
    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseenter"));
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    expect(styleOf(cardHost())).toContain(SHADOW_CSS);
  });

  it("draws the paused state when Tier 2 is off and respects the label style", async () => {
    const harness: Harness = makeHarness(config({ tiers: { t1: true, t2: false } }), {
      ...QUIET_SETTINGS,
      labelStyle: "sus",
    });
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();

    const button: HTMLButtonElement = badgeButton("alice.example.com");
    expect(button.className).toContain("bd-badge--paused");
    expect(button.textContent).toContain("Kinda sus");
  });

  it("opens the card on hover, runs the lookup and rescored badge, records feedback and opens settings", async () => {
    const harness: Harness = makeHarness();
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();

    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseenter"));
    await flush();
    await vi.advanceTimersByTimeAsync(200);

    const host: HTMLElement | null = cardHost();
    expect(host?.style.getPropertyValue("--botdar-display")).toBe("block");
    expect(host?.style.getPropertyValue("--botdar-top")).not.toBe("");
    const card: ShadowRoot | null | undefined = host?.shadowRoot;
    expect(card?.querySelector(".bd-card__handle")?.textContent).toBe("@alice.example.com");
    expect(card?.querySelector(".bd-card__legend")).not.toBeNull();
    expect(harness.resolve).toHaveBeenCalledTimes(1);
    expect(badgeButton("alice.example.com").getAttribute("aria-label")).toBe("Likely bot");
    expect(badgeButton("alice.example.com").getAttribute("aria-describedby")).toBe("botdar-card");
    expect(card?.querySelector(".bd-card__title")?.textContent).toBe("Likely bot");
    expect(
      [...(card?.querySelectorAll(".bd-card__fact") ?? [])].map((item) => item.textContent),
    ).toEqual(["reason:bsky.displayName", "reason:bsky.hasDefaultAvatar", "reason:bsky.followers"]);
    expect(card?.querySelector(".bd-card__reason .bd-dot--2")).not.toBeNull();

    (card?.querySelector(".bd-btn") as HTMLButtonElement).click();
    await flush();
    expect(harness.recordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "bluesky", handle: "alice.example.com", tier: "many" }),
    );
    expect(card?.querySelector(".bd-btn--sent")).not.toBeNull();
    (card?.querySelector(".bd-btn--sent") as HTMLButtonElement).click();
    await flush();
    expect(harness.removeFeedback).toHaveBeenCalledWith("fb-1");

    (card?.querySelector(".bd-btn--link") as HTMLButtonElement).click();
    expect(harness.openOptionsPage).toHaveBeenCalledTimes(1);

    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseleave"));
    await vi.advanceTimersByTimeAsync(250);
    expect(host?.style.getPropertyValue("--botdar-display")).toBe("none");
    expect(badgeButton("alice.example.com").getAttribute("aria-describedby")).toBeNull();
  });

  it("keeps the source legend for the whole first opening and drops it after", async () => {
    const harness: Harness = makeHarness();
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();
    const legend = (): Element | null | undefined =>
      cardHost()?.shadowRoot?.querySelector(".bd-card__legend");

    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseenter"));
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    expect(harness.resolve).toHaveBeenCalledTimes(1);
    expect(legend()).not.toBeNull();

    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseleave"));
    await vi.advanceTimersByTimeAsync(250);
    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseenter"));
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    expect(cardHost()?.style.getPropertyValue("--botdar-display")).toBe("block");
    expect(legend()).toBeNull();
  });

  it("spends no lookup on a pointer that passes over a badge before the card opens", async () => {
    const harness: Harness = makeHarness();
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();

    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseenter"));
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseleave"));
    await vi.advanceTimersByTimeAsync(500);

    expect(cardHost()?.style.getPropertyValue("--botdar-display")).not.toBe("block");
    expect(harness.resolve).not.toHaveBeenCalled();
  });

  it("does not run the lookup when Tier 2 is off", async () => {
    const harness: Harness = makeHarness(config({ tiers: { t1: true, t2: false } }));
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();

    badgeButton("alice.example.com").dispatchEvent(new MouseEvent("mouseenter"));
    await flush();
    await vi.advanceTimersByTimeAsync(200);

    expect(cardHost()?.style.getPropertyValue("--botdar-display")).toBe("block");
    expect(harness.resolve).not.toHaveBeenCalled();
  });

  it("draws the Likely human badge by default and unmounts it when the setting is turned off", async () => {
    const harness: Harness = makeHarness(config(), defaultSettings);
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();
    expect(badgeButton("newsroom.example.org").getAttribute("aria-label")).toBe("Likely human");

    harness.emitSettings(QUIET_SETTINGS);
    await flush();
    expect(badgeAfter("newsroom.example.org")).toBeNull();

    harness.emitSettings(defaultSettings);
    await flush();
    expect(badgeButton("newsroom.example.org").getAttribute("aria-label")).toBe("Likely human");
  });

  it("removes every badge when the platform is switched off and resumes when it is back", async () => {
    const harness: Harness = makeHarness();
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();

    harness.emitConfig(config({ enabled: false }));
    await flush();
    expect(document.querySelectorAll(BADGE_ELEMENT_NAME)).toHaveLength(0);

    harness.emitConfig(config());
    await flush();
    expect(document.querySelectorAll(BADGE_ELEMENT_NAME)).toHaveLength(2);
  });

  it("unmounts the badge of a post the feed dropped", async () => {
    const harness: Harness = makeHarness();
    stop = await wireBluesky(new ContentScriptContext("bluesky"), SHADOW_CSS, harness.deps);
    await flush();
    const post: Element | null = document.querySelector(
      '[data-testid="feedItem-by-alice.example.com"]',
    );
    const badge: HTMLElement | null = badgeAfter("alice.example.com");

    post?.remove();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);

    expect(badge?.isConnected).toBe(false);
    expect(document.querySelectorAll(BADGE_ELEMENT_NAME)).toHaveLength(1);
  });

  it("tears everything down on stop", async () => {
    const harness: Harness = makeHarness();
    const teardown: () => void = await wireBluesky(
      new ContentScriptContext("bluesky"),
      SHADOW_CSS,
      harness.deps,
    );
    await flush();

    teardown();

    expect(document.querySelectorAll(BADGE_ELEMENT_NAME)).toHaveLength(0);
    expect(cardHost()).toBeNull();
  });
});
