/**
 * Orchestration for the Reddit content script: effective config and settings, the AccountResolver
 * with the real scorer, one badge per discovered post and the single hover card. The entrypoint
 * only calls wireReddit with the shadow-root stylesheet text it bundled; everything with a side
 * effect is injectable so the wiring is testable against fixture pages with a fake scorer.
 */
import { h, render } from "preact";
import { kindOfPost, recordBadged } from "../../core/diagnostics.ts";
import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { TtlLruCache } from "../../core/cache";
import type { FeedbackEntry } from "../../core/feedback";
import { recordFeedback, removeFeedback } from "../../core/feedback";
import { onRequest, sendRequest } from "../../core/messaging";
import type { BadgeHandle, Scorer } from "../../core/pipeline";
import { AccountResolver, TIER2_CACHE_TTL_MS } from "../../core/pipeline";
import { buildDefaults } from "../../core/policy/defaults";
import { loadLastKnownGood } from "../../core/policy/loader";
import { applyPolicy } from "../../core/policy/merge";
import { RateLimiter } from "../../core/ratelimit";
import { scoreAccount } from "../../core/scoring/engine";
import type { PlatformWeights } from "../../core/scoring/types";
import { defaultWeights } from "../../core/scoring/weights";
import type { Settings } from "../../core/settings";
import { applySettings, loadSettings, onSettingsChanged } from "../../core/settings";
import type {
  EffectivePlatformConfig,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  SourceTier,
  Verdict,
} from "../../core/types";
import { Badge } from "../../ui/Badge";
import type { CardReason } from "../../ui/HoverCard";
import { HoverCard } from "../../ui/HoverCard";
import type { HoverController } from "../../ui/hoverController";
import { createHoverController } from "../../ui/hoverController";
import { shouldDrawBadge } from "../../ui/labels";
import type { MountedUi } from "../../ui/mount";
import { detectHostTheme, mountBadge, mountCard } from "../../ui/mount";
import { noReadCardProps } from "../../ui/noRead";
import { redditAdapter } from "./adapter";

export interface RedditRuntime {
  config: EffectivePlatformConfig;
  weights: PlatformWeights;
  settings: Settings;
}

export type ScorerFactory = (runtime: () => RedditRuntime) => Scorer;

export interface WireRedditOptions {
  adapter?: PlatformAdapter;
  loadRuntime?: () => Promise<RedditRuntime>;
  scorer?: ScorerFactory;
  openSettings?: () => void;
}

export const CARD_ID = "botdar-card";
const CACHE_CAPACITY = 500;
const LOOKUP_BURST = 3;

/** Build defaults narrowed by the cached policy and the settings; the background's answer wins for the config. */
export async function loadRedditRuntime(): Promise<RedditRuntime> {
  const [cached, settings] = await Promise.all([loadLastKnownGood(), loadSettings()]);
  const effective = applySettings(
    applyPolicy(buildDefaults, defaultWeights, cached?.policy ?? null),
    settings,
  );
  let config: EffectivePlatformConfig = effective.platforms.reddit;
  try {
    config = (await sendRequest({ type: "config.get", platform: "reddit" })).config;
  } catch {
    // The background broker is the authority once it serves config.get; until then the local
    // merge above is the same computation on the same stored policy.
  }
  return { config, weights: effective.weights.reddit, settings };
}

function allowedTiers(config: EffectivePlatformConfig): SourceTier[] {
  const tiers: SourceTier[] = [0];
  if (config.tiers.t1) tiers.push(1);
  if (config.tiers.t2) tiers.push(2);
  return tiers;
}

const realScorer: ScorerFactory = (runtime) => (features, signals) =>
  scoreAccount(features, signals, runtime().weights, {
    policyVersion: runtime().config.policyVersion,
    sourcesAvailable: allowedTiers(runtime().config),
  });

function reasonsOf(verdict: Verdict): CardReason[] {
  return verdict.reasons.map((text) => ({
    text,
    tier: verdict.evidence.find((item) => item.reason === text)?.tier ?? 0,
  }));
}

interface BadgeSlot {
  post: PostRef;
  handle: BadgeHandle;
  verdict: Verdict;
  mounted: MountedUi | null;
  container: HTMLElement | null;
  mounting: Promise<void> | null;
  unsubscribe: () => void;
}

export async function wireReddit(
  ctx: ContentScriptContext,
  shadowCss: string,
  options: WireRedditOptions = {},
): Promise<() => void> {
  const adapter: PlatformAdapter = options.adapter ?? redditAdapter;
  const loadRuntime: () => Promise<RedditRuntime> = options.loadRuntime ?? loadRedditRuntime;
  const openSettings: () => void =
    options.openSettings ?? ((): void => void browser.runtime.openOptionsPage());
  let runtime: RedditRuntime = await loadRuntime();
  const theme = (): "light" | "dark" => detectHostTheme("reddit");

  const resolver = new AccountResolver({
    adapter,
    scorer: (options.scorer ?? realScorer)(() => runtime),
    config: runtime.config,
    // A lowered rate limit applies on the next page load; switching Tier 2 off applies at once.
    limiter: new RateLimiter({ perMinute: runtime.config.rateLimitPerMinute, burst: LOOKUP_BURST }),
    cache: new TtlLruCache<string, PartialSignals>(CACHE_CAPACITY, TIER2_CACHE_TTL_MS),
  });
  const slots = new Map<Element, BadgeSlot>();
  const slotByHost = new WeakMap<Element, BadgeSlot>();
  const feedbackByHandle = new Map<string, Promise<FeedbackEntry>>();
  let openSlot: BadgeSlot | null = null;
  let lookupPending = false;
  let legendShown = false;
  let cardContainer: HTMLElement | null = null;
  let stopObserving: (() => void) | null = null;

  // MARK: - Hover card

  const card: MountedUi = await mountCard(
    ctx,
    (container) => {
      cardContainer = container;
      return () => render(null, container);
    },
    theme(),
    shadowCss,
  );
  card.setVisible(false);

  const toggleFeedback = (slot: BadgeSlot): void => {
    const handle: string = slot.post.ref.handle;
    const pending: Promise<FeedbackEntry> | undefined = feedbackByHandle.get(handle);
    if (pending !== undefined) {
      feedbackByHandle.delete(handle);
      void pending.then((entry) => removeFeedback(entry.id));
    } else {
      const { tier, reasons, computedAt } = slot.verdict;
      feedbackByHandle.set(
        handle,
        recordFeedback({ platform: "reddit", handle, tier, reasons, computedAt }),
      );
    }
    renderCard();
  };

  const renderCard = (): void => {
    const slot: BadgeSlot | null = openSlot;
    if (slot === null || cardContainer === null) return;
    const verdict: Verdict = slot.verdict;
    // No tier hides an open card any more: a badge that stops being drawn (Likely human turned
    // off) is unmounted, and unmountBadge closes the card first.
    render(
      h(HoverCard, {
        id: CARD_ID,
        tier: verdict.tier,
        labelStyle: runtime.settings.labelStyle,
        handle: `u/${slot.post.ref.handle}`,
        reasons: reasonsOf(verdict),
        ...(verdict.confidenceNote === undefined ? {} : { confidenceNote: verdict.confidenceNote }),
        caveat: verdict.caveat,
        ...noReadCardProps(verdict, slot.handle),
        loading: lookupPending,
        lowConfidence: verdict.lowConfidence,
        showLegend: !legendShown,
        feedbackSent: feedbackByHandle.has(slot.post.ref.handle),
        onFeedback: () => toggleFeedback(slot),
        onSettings: openSettings,
      }),
      cardContainer,
    );
  };

  const controller: HoverController = createHoverController({
    render: (host) => {
      const slot: BadgeSlot | undefined = slotByHost.get(host);
      if (slot === undefined) return 0;
      openSlot = slot;
      renderCard();
      legendShown = true;
      card.setTheme(theme());
      card.setVisible(true);
      if (runtime.config.tiers.t2 && !lookupPending) {
        lookupPending = true;
        renderBadge(slot);
        void slot.handle.lookup().finally(() => {
          lookupPending = false;
          renderBadge(slot);
          renderCard();
        });
      }
      return cardContainer?.getBoundingClientRect().height ?? 0;
    },
    hide: () => {
      openSlot = null;
      card.setVisible(false);
    },
    place: ({ top, left }) => {
      card.setPlacement({ top, left });
    },
  });
  ctx.addEventListener(card.shadowHost, "mouseenter", () => controller.holdOpen());
  ctx.addEventListener(card.shadowHost, "mouseleave", () => controller.requestClose());

  // MARK: - Badges

  const renderBadge = (slot: BadgeSlot): void => {
    const container: HTMLElement | null = slot.container;
    if (
      container === null ||
      !shouldDrawBadge(slot.verdict.tier, runtime.settings.showLikelyHuman)
    ) {
      return;
    }
    render(
      h(Badge, {
        tier: slot.verdict.tier,
        labelStyle: runtime.settings.labelStyle,
        density: slot.post.density ?? adapter.badgeDensity,
        lowConfidence: slot.verdict.lowConfidence,
        paused: !runtime.config.tiers.t2,
        loading: openSlot === slot && lookupPending,
        glyphOnlyAtCommentDensity: runtime.settings.redditCommentLabels !== "label",
        onOpen: () => {
          if (slot.mounted !== null) controller.requestOpen(slot.mounted.shadowHost);
        },
        onClose: () => controller.requestClose(),
      }),
      container,
    );
  };

  const unmountBadge = (slot: BadgeSlot): void => {
    if (slot.mounted === null) return;
    if (openSlot === slot) controller.closeNow();
    slot.mounted.remove();
    slot.mounted = null;
    slot.container = null;
  };

  const syncBadge = (slot: BadgeSlot): void => {
    if (!shouldDrawBadge(slot.verdict.tier, runtime.settings.showLikelyHuman)) {
      unmountBadge(slot);
      return;
    }
    if (slot.mounted !== null || slot.mounting !== null) {
      renderBadge(slot);
      return;
    }
    slot.mounting = mountBadge(
      ctx,
      slot.post.anchor,
      (container) => {
        slot.container = container;
        renderBadge(slot);
        return () => render(null, container);
      },
      theme(),
      shadowCss,
    )
      .then((mounted) => {
        if (!slots.has(slot.post.element)) {
          mounted.remove();
          return;
        }
        slot.mounted = mounted;
        // A host adopted from an earlier script instance never ran the render callback.
        slot.container ??= mounted.shadowHost.shadowRoot?.querySelector("body") ?? null;
        slotByHost.set(mounted.shadowHost, slot);
        slot.post.element.setAttribute("data-botdar", "1");
        recordBadged(kindOfPost(slot.post), slot.post.element);
        syncBadge(slot);
      })
      .finally(() => {
        slot.mounting = null;
      });
  };

  const attachPost = (post: PostRef): void => {
    if (slots.has(post.element)) return;
    const handle: BadgeHandle = resolver.attach(post);
    const slot: BadgeSlot = {
      post,
      handle,
      verdict: handle.current(),
      mounted: null,
      container: null,
      mounting: null,
      unsubscribe: () => undefined,
    };
    slots.set(post.element, slot);
    slot.unsubscribe = handle.subscribe((verdict) => {
      slot.verdict = verdict;
      syncBadge(slot);
      if (openSlot === slot) renderCard();
    });
    syncBadge(slot);
  };

  const detachElement = (element: Element): void => {
    const slot: BadgeSlot | undefined = slots.get(element);
    if (slot === undefined) return;
    slots.delete(element);
    slot.unsubscribe();
    unmountBadge(slot);
    resolver.detach(slot.post);
    element.removeAttribute("data-botdar");
  };

  // MARK: - Runtime changes

  const observeIfEnabled = (): void => {
    if (runtime.config.enabled && stopObserving === null) {
      stopObserving = adapter.observeFeed(attachPost, detachElement);
    } else if (!runtime.config.enabled && stopObserving !== null) {
      stopObserving();
      stopObserving = null;
      for (const element of [...slots.keys()]) detachElement(element);
    }
  };

  const applyRuntime = (next: RedditRuntime): void => {
    runtime = next;
    resolver.updateConfig(next.config);
    observeIfEnabled();
    for (const slot of slots.values()) syncBadge(slot);
    renderCard();
  };

  const stopConfigChanges: () => void = onRequest("config.changed", (message) => {
    void loadRuntime().then((fresh) => applyRuntime({ ...fresh, config: message.configs.reddit }));
    return undefined;
  });
  const stopSettingsChanges: () => void = onSettingsChanged(() => {
    void loadRuntime().then(applyRuntime);
  });
  observeIfEnabled();

  const dispose = (): void => {
    stopConfigChanges();
    stopSettingsChanges();
    stopObserving?.();
    stopObserving = null;
    for (const element of [...slots.keys()]) detachElement(element);
    controller.dispose();
    card.remove();
    resolver.dispose();
  };
  ctx.onInvalidated(dispose);
  return dispose;
}
