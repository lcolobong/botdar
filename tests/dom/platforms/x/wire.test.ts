// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}

import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { TtlLruCache } from "@/src/core/cache";
import type { FeedbackEntry, FeedbackInput } from "@/src/core/feedback";
import { AccountResolver, TIER2_CACHE_TTL_MS, type Scorer } from "@/src/core/pipeline";
import { RateLimiter } from "@/src/core/ratelimit";
import { defaultSettings, type Settings } from "@/src/core/settings";
import type {
  EffectivePlatformConfig,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  SignalSource,
  SourceTier,
} from "@/src/core/types";
import { BADGE_ELEMENT_NAME, CARD_ELEMENT_NAME } from "@/src/ui/mount";
import { adoptedCssOf } from "../../adoptedCss";
import { createXAdapter } from "@/src/platforms/x/adapter";
import { BADGED_ATTRIBUTE, markBadged, toPostRef, unmarkBadged } from "@/src/platforms/x/dom";
import { QueryIdRegistry } from "@/src/platforms/x/queryIds";
import { wirePlatform, type PlatformWiring } from "@/src/platforms/x/wire";
import { loadTimeline, timelineArticles } from "./timelineFixture";

const SHADOW_CSS = ":host { --botdar-test: x; }";
const ALL_TIERS: SourceTier[] = [0, 1, 2];
const TIER_BY_HANDLE: Record<string, "many" | "typical"> = {
  maria_dev: "many",
  alice_example: "typical",
};

/** Declared from the Tier 0 label, otherwise a fixed tier per fixture handle. */
const fakeScorer: Scorer = (features, signals, sourcesAvailable) => ({
  tier:
    signals.declaredAutomated === true
      ? "declared"
      : (TIER_BY_HANDLE[signals.ref.handle] ?? "unknown"),
  probability: 0.5,
  logOdds: 0,
  evidence: [
    {
      feature: "x.handleTrailingDigits",
      contribution: 0.5,
      group: "handle",
      tier: 0,
      reason: "Ends in 5 digits",
    },
  ],
  reasons: ["Ends in 5 digits", "Joined 3 weeks ago"],
  confidence: sourcesAvailable.length / ALL_TIERS.length,
  caveat: "This can be wrong: new accounts look like this too.",
  sourcesUsed: sourcesAvailable,
  sourcesMissing: ALL_TIERS.filter((tier) => !sourcesAvailable.includes(tier)),
  lowConfidence: sourcesAvailable.length < 2,
  policyVersion: 1,
  computedAt: Date.now(),
});

const fakeContext = (): ContentScriptContext =>
  ({ options: {}, onInvalidated: () => () => undefined }) as unknown as ContentScriptContext;

interface Harness {
  wiring: PlatformWiring;
  posts: PostRef[];
  settings: Settings;
  config: EffectivePlatformConfig;
  lookup: ReturnType<typeof vi.fn>;
  recordFeedback: ReturnType<typeof vi.fn>;
  openSettings: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  loadTimeline();
  // Likely human off, so typical authors draw nothing unless a test turns it on.
  const settings: Settings = { ...defaultSettings, showLikelyHuman: false };
  const config: EffectivePlatformConfig = {
    platform: "x",
    enabled: true,
    tiers: { t1: true, t2: true },
    rateLimitPerMinute: 20,
    policyVersion: 1,
  };
  const lookup = vi.fn(async (): Promise<PartialSignals | null> => ({ country: "Brazil" }));
  const activeSource: SignalSource = {
    id: "fake.about",
    platform: "x",
    tier: 2,
    kind: "active",
    resolve: lookup,
  };
  const adapter: PlatformAdapter = {
    ...createXAdapter({ registry: new QueryIdRegistry() }),
    sources: [activeSource],
  };
  const resolver = new AccountResolver({
    adapter,
    scorer: fakeScorer,
    config,
    limiter: new RateLimiter({ perMinute: 20, burst: 3 }),
    cache: new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS),
  });
  const recordFeedback = vi.fn(async (input: FeedbackInput): Promise<FeedbackEntry> => ({
    ...input,
    id: "feedback-1",
    recordedAt: Date.now(),
  }));
  const openSettings = vi.fn();
  const wiring: PlatformWiring = wirePlatform({
    ctx: fakeContext(),
    adapter,
    resolver,
    shadowCss: SHADOW_CSS,
    settings: () => settings,
    config: () => config,
    markBadged,
    unmarkBadged,
    recordFeedback,
    removeFeedback: async () => true,
    openSettings,
    handlePrefix: "@",
  });
  const posts: PostRef[] = timelineArticles().flatMap((article) => toPostRef(article) ?? []);
  return { wiring, posts, settings, config, lookup, recordFeedback, openSettings };
}

const badgeHosts = (): HTMLElement[] => Array.from(document.querySelectorAll(BADGE_ELEMENT_NAME));

const badgeButton = (host: Element): HTMLButtonElement => {
  const button: HTMLButtonElement | null | undefined =
    host.shadowRoot?.querySelector("button.bd-badge");
  if (!button) throw new Error("badge host has no button");
  return button;
};

const badgedHandles = (): string[] =>
  timelineArticles()
    .filter((article) => article.hasAttribute(BADGED_ATTRIBUTE))
    .flatMap((article) => toPostRef(article)?.ref.handle ?? []);

async function badgesSettled(count: number): Promise<void> {
  await vi.waitFor(() => expect(badgeHosts()).toHaveLength(count));
}

let harness: Harness;

beforeEach(() => {
  document.body.innerHTML = "";
  harness = makeHarness();
  for (const post of harness.posts) harness.wiring.attach(post);
});

afterEach(() => {
  harness.wiring.stop();
});

describe("wirePlatform badges", () => {
  it("mounts badges only for drawn tiers and marks those posts", async () => {
    await badgesSettled(2);
    expect(badgedHandles()).toEqual(["kai09127364", "maria_dev"]);
    const [declared, many] = badgeHosts();
    expect(declared && badgeButton(declared).getAttribute("aria-label")).toBe("Declared bot");
    expect(many && badgeButton(many).getAttribute("aria-label")).toBe("Likely bot");
    expect(many && badgeButton(many).className).toContain("bd-badge--hollow");
  });

  it("draws the Likely human badge once the setting is on, and removes it again", async () => {
    await badgesSettled(2);
    harness.settings.showLikelyHuman = true;
    harness.wiring.refresh();
    await badgesSettled(3);
    expect(badgedHandles()).toEqual(["alice_example", "kai09127364", "maria_dev"]);
    harness.settings.showLikelyHuman = false;
    harness.wiring.refresh();
    await badgesSettled(2);
    expect(badgedHandles()).toEqual(["kai09127364", "maria_dev"]);
  });

  it("re-renders label style and the paused state in place", async () => {
    await badgesSettled(2);
    harness.settings.labelStyle = "sus";
    harness.config.tiers.t2 = false;
    harness.wiring.refresh();
    const [, many] = badgeHosts();
    expect(many && badgeButton(many).textContent).toBe("Sus");
    expect(many && badgeButton(many).className).toContain("bd-badge--paused");
    expect(badgeHosts()).toHaveLength(2);
  });

  it("removes every badge when the platform is disabled", async () => {
    await badgesSettled(2);
    harness.config.enabled = false;
    harness.wiring.refresh();
    await badgesSettled(0);
    expect(badgedHandles()).toEqual([]);
  });

  it("unmounts the badge and the mark when a post is released", async () => {
    await badgesSettled(2);
    const kai: PostRef | undefined = harness.posts[1];
    if (kai === undefined) throw new Error("fixture post missing");
    harness.wiring.release(kai.element);
    expect(badgeHosts()).toHaveLength(1);
    expect(badgedHandles()).toEqual(["maria_dev"]);
    harness.wiring.release(kai.element);
    expect(badgeHosts()).toHaveLength(1);
  });

  it("writes the bundled stylesheet into the badge and card shadow roots", async () => {
    await badgesSettled(2);
    const styleOf = (host: Element | null): string => adoptedCssOf(host);
    expect(styleOf(badgeHosts()[0] ?? null)).toContain(SHADOW_CSS);
    await vi.waitFor(() =>
      expect(styleOf(document.querySelector(CARD_ELEMENT_NAME))).toContain(SHADOW_CSS),
    );
  });

  it("never mounts for a post whose badge is not drawable at attach time", async () => {
    await badgesSettled(2);
    const alice: Element | undefined = timelineArticles()[0];
    expect(alice?.querySelector(BADGE_ELEMENT_NAME)).toBeNull();
    expect(alice?.hasAttribute(BADGED_ATTRIBUTE)).toBe(false);
  });
});

describe("wirePlatform hover card", () => {
  it("opens the card from the badge, runs the lookup, records feedback and closes", async () => {
    await badgesSettled(2);
    await vi.waitFor(() => expect(document.querySelector(CARD_ELEMENT_NAME)).not.toBeNull());
    const cardHost: HTMLElement | null = document.querySelector(CARD_ELEMENT_NAME);
    if (cardHost === null) throw new Error("card host missing");
    expect(cardHost.style.getPropertyValue("--botdar-display")).toBe("none");
    const [, many] = badgeHosts();
    if (many === undefined) throw new Error("badge missing");

    vi.useFakeTimers();
    try {
      badgeButton(many).dispatchEvent(new Event("mouseenter"));
      await vi.advanceTimersByTimeAsync(150);
      expect(cardHost.style.getPropertyValue("--botdar-display")).toBe("block");
      const card: ShadowRoot | null = cardHost.shadowRoot;
      expect(card?.querySelector(".bd-card__handle")?.textContent).toBe("@maria_dev");
      expect(card?.querySelectorAll(".bd-card__reason")).toHaveLength(2);
      expect(card?.querySelector(".bd-card__reason .bd-dot--0")).not.toBeNull();
      expect(card?.querySelector(".bd-card__legend")).not.toBeNull();
      expect(harness.lookup).toHaveBeenCalledTimes(1);
      expect(badgeButton(many).getAttribute("aria-describedby")).toBe("botdar-card");

      const feedback: HTMLButtonElement | null | undefined = card?.querySelector(".bd-btn");
      feedback?.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.recordFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ platform: "x", handle: "maria_dev", tier: "many" }),
      );
      expect(card?.querySelector(".bd-btn--sent")).not.toBeNull();

      const settings: HTMLButtonElement | null | undefined = card?.querySelector(".bd-btn--link");
      settings?.click();
      expect(harness.openSettings).toHaveBeenCalledTimes(1);

      badgeButton(many).dispatchEvent(new Event("mouseleave"));
      await vi.advanceTimersByTimeAsync(200);
      expect(cardHost.style.getPropertyValue("--botdar-display")).toBe("none");
      expect(badgeButton(many).getAttribute("aria-describedby")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the lookup while Tier 2 is off", async () => {
    await badgesSettled(2);
    await vi.waitFor(() => expect(document.querySelector(CARD_ELEMENT_NAME)).not.toBeNull());
    harness.config.tiers.t2 = false;
    const [, many] = badgeHosts();
    if (many === undefined) throw new Error("badge missing");
    vi.useFakeTimers();
    try {
      badgeButton(many).dispatchEvent(new Event("mouseenter"));
      await vi.advanceTimersByTimeAsync(150);
      expect(harness.lookup).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
