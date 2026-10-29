/**
 * Orchestration for the Bluesky content script: effective config and settings in, the
 * AccountResolver over the adapter, one badge per attached post, one hover card, and the
 * subscriptions that keep every verdict and badge in step with policy and settings changes. The
 * entrypoint passes the shadow-root stylesheet text it bundled; everything else external is
 * injected through WireDependencies so the flow is testable with a fake scorer under happy-dom.
 */
import { h, render } from "preact";
import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { BADGED_ATTRIBUTE } from "../../core/botdarMarks";
import { TtlLruCache } from "../../core/cache";
import { PersistedLookupStore } from "../../core/persistedLookups";
import { kindOfPost, recordBadged } from "../../core/diagnostics.ts";
import { recordFeedback, removeFeedback } from "../../core/feedback";
import { onRequest, sendRequest } from "../../core/messaging";
import { AccountResolver, TIER2_CACHE_TTL_MS } from "../../core/pipeline";
import type { BadgeHandle, Scorer } from "../../core/pipeline";
import { getEffectiveConfig } from "../../core/policy/loader";
import { RateLimiter } from "../../core/ratelimit";
import { scoreAccount } from "../../core/scoring/engine";
import type { PlatformWeights } from "../../core/scoring/types";
import { defaultWeights } from "../../core/scoring/weights";
import { loadSettings, onSettingsChanged } from "../../core/settings";
import type { Settings } from "../../core/settings";
import type {
  EffectivePlatformConfig,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  SourceTier,
  Verdict,
} from "../../core/types";
import { Badge } from "../../ui/Badge";
import type { BadgeProps } from "../../ui/Badge";
import { shouldDrawBadge } from "../../ui/labels";
import { CARD_ID, detectHostTheme, mountBadge } from "../../ui/mount";
import type { MountedUi } from "../../ui/mount";
import { createBlueskyAdapter } from "./adapter";
import { createCardPresenter } from "./cardPresenter";
import type { CardPresenter } from "./cardPresenter";

const PLATFORM = "bluesky";
const CACHE_CAPACITY = 500;
/** Three hovered authors back to back; each lookup spends two tokens (getProfiles, getAuthorFeed). */
const LIMITER_BURST = 6;

export interface WireDependencies {
  adapter: PlatformAdapter;
  score: typeof scoreAccount;
  loadConfig: () => Promise<EffectivePlatformConfig>;
  loadWeights: () => Promise<PlatformWeights>;
  loadSettings: () => Promise<Settings>;
  onConfigChanged: (listener: (config: EffectivePlatformConfig) => void) => () => void;
  onSettingsChanged: (listener: (settings: Settings) => void) => () => void;
  recordFeedback: typeof recordFeedback;
  removeFeedback: typeof removeFeedback;
  openOptionsPage: () => void;
}

interface BadgeEntry {
  post: PostRef;
  handle: BadgeHandle;
  verdict: Verdict;
  unsubscribe: () => void;
  mounted: MountedUi | undefined;
  mounting: Promise<void> | undefined;
  container: HTMLElement | undefined;
}

/**
 * The background answers config.get once its settings broker lands; until then, and whenever the
 * worker cannot answer, the content script runs the same restrict-only merge over the cached policy.
 */
async function requestConfig(): Promise<EffectivePlatformConfig> {
  try {
    return (await sendRequest({ type: "config.get", platform: PLATFORM })).config;
  } catch {
    return (await getEffectiveConfig(defaultWeights)).platforms[PLATFORM];
  }
}

export function defaultDependencies(): WireDependencies {
  return {
    adapter: createBlueskyAdapter(),
    score: scoreAccount,
    loadConfig: requestConfig,
    loadWeights: async () => (await getEffectiveConfig(defaultWeights)).weights[PLATFORM],
    loadSettings,
    onConfigChanged: (listener) =>
      onRequest("config.changed", (message) => {
        listener(message.configs[PLATFORM]);
        return undefined;
      }),
    onSettingsChanged,
    recordFeedback,
    removeFeedback,
    openOptionsPage: () => void browser.runtime.openOptionsPage(),
  };
}

function enabledTiers(config: EffectivePlatformConfig): SourceTier[] {
  const tiers: SourceTier[] = [0];
  if (config.tiers.t1) tiers.push(1);
  if (config.tiers.t2) tiers.push(2);
  return tiers;
}

export async function wireBluesky(
  ctx: ContentScriptContext,
  shadowCss: string,
  deps: WireDependencies = defaultDependencies(),
): Promise<() => void> {
  const [initialConfig, initialWeights, initialSettings] = await Promise.all([
    deps.loadConfig(),
    deps.loadWeights(),
    deps.loadSettings(),
  ]);
  let config: EffectivePlatformConfig = initialConfig;
  let weights: PlatformWeights = initialWeights;
  let settings: Settings = initialSettings;
  const entries = new Map<Element, BadgeEntry>();
  let stopObserving: (() => void) | undefined;

  const scorer: Scorer = (features, signals) =>
    deps.score(features, signals, weights, {
      policyVersion: config.policyVersion,
      sourcesAvailable: enabledTiers(config),
    });
  const resolver = new AccountResolver({
    adapter: deps.adapter,
    scorer,
    config,
    // The limiter is sized once: a lowered policy limit applies from the next page load.
    limiter: new RateLimiter({ perMinute: config.rateLimitPerMinute, burst: LIMITER_BURST }),
    cache: new TtlLruCache<string, PartialSignals>(CACHE_CAPACITY, TIER2_CACHE_TTL_MS),
    persistence: { store: new PersistedLookupStore(), enabled: () => settings.persistLookups },
  });

  const card: CardPresenter = createCardPresenter({
    ctx,
    theme: () => detectHostTheme(PLATFORM),
    shadowCss,
    labelStyle: () => settings.labelStyle,
    showLikelyHuman: () => settings.showLikelyHuman,
    lookupsEnabled: () => config.tiers.t2,
    recordFeedback: deps.recordFeedback,
    removeFeedback: deps.removeFeedback,
    openOptionsPage: deps.openOptionsPage,
    onBadgeStateChange: (element) => {
      const entry: BadgeEntry | undefined = entries.get(element);
      if (entry !== undefined) renderBadge(entry);
    },
  });

  const badgeProps = (entry: BadgeEntry, tier: BadgeProps["tier"]): BadgeProps => ({
    tier,
    labelStyle: settings.labelStyle,
    density: deps.adapter.badgeDensity,
    lowConfidence: entry.verdict.lowConfidence,
    paused: !config.tiers.t2,
    loading: card.isLoadingFor(entry.post.element),
    glyphOnlyAtCommentDensity: false,
    ...(card.isOpenFor(entry.post.element) ? { describedBy: CARD_ID } : {}),
    onOpen: () => {
      if (entry.mounted !== undefined) {
        card.open({ post: entry.post, handle: entry.handle, anchor: entry.mounted.shadowHost });
      }
    },
    onClose: card.requestClose,
  });

  const unmountBadge = (entry: BadgeEntry): void => {
    entry.mounted?.remove();
    entry.mounted = undefined;
    entry.container = undefined;
  };

  const renderBadge = (entry: BadgeEntry): void => {
    const tier: Verdict["tier"] = entry.verdict.tier;
    if (!config.enabled || !shouldDrawBadge(tier, settings.showLikelyHuman)) {
      unmountBadge(entry);
      return;
    }
    if (entry.container !== undefined) {
      render(h(Badge, badgeProps(entry, tier)), entry.container);
      return;
    }
    if (entry.mounting !== undefined) {
      return;
    }
    // A host adopted from an earlier script instance has no live render; replace it with our own.
    if (entry.mounted !== undefined) {
      unmountBadge(entry);
    }
    entry.mounting = mountBadge(
      ctx,
      entry.post.anchor,
      (container: HTMLElement): (() => void) => {
        entry.container = container;
        render(h(Badge, badgeProps(entry, tier)), container);
        return () => {
          render(null, container);
          entry.container = undefined;
        };
      },
      detectHostTheme(PLATFORM),
      shadowCss,
    ).then((mounted: MountedUi) => {
      entry.mounting = undefined;
      entry.mounted = mounted;
      if (entries.get(entry.post.element) === entry) {
        recordBadged(kindOfPost(entry.post), entry.post.element);
        renderBadge(entry);
      } else {
        unmountBadge(entry);
      }
    });
  };

  const attachPost = (post: PostRef): void => {
    if (entries.has(post.element)) {
      return;
    }
    const handle: BadgeHandle = resolver.attach(post);
    post.element.setAttribute(BADGED_ATTRIBUTE, "1");
    const entry: BadgeEntry = {
      post,
      handle,
      verdict: handle.current(),
      unsubscribe: () => undefined,
      mounted: undefined,
      mounting: undefined,
      container: undefined,
    };
    entry.unsubscribe = handle.subscribe((verdict: Verdict) => {
      entry.verdict = verdict;
      renderBadge(entry);
      if (card.isOpenFor(post.element)) card.refresh();
    });
    entries.set(post.element, entry);
    renderBadge(entry);
  };

  const detachPost = (element: Element): void => {
    const entry: BadgeEntry | undefined = entries.get(element);
    if (entry === undefined) {
      return;
    }
    entries.delete(element);
    // Clearing the mark lets the observer rediscover the post if the platform is switched back on.
    element.removeAttribute(BADGED_ATTRIBUTE);
    entry.unsubscribe();
    resolver.detach(entry.post);
    if (card.isOpenFor(element)) card.closeNow();
    unmountBadge(entry);
  };

  const renderAll = (): void => {
    for (const entry of entries.values()) renderBadge(entry);
    card.refresh();
  };

  const applyConfig = (next: EffectivePlatformConfig): void => {
    config = next;
    resolver.updateConfig(next);
    if (!next.enabled) {
      stopObserving?.();
      stopObserving = undefined;
      for (const element of [...entries.keys()]) detachPost(element);
      return;
    }
    stopObserving ??= deps.adapter.observeFeed(attachPost, detachPost);
    void deps.loadWeights().then((loaded: PlatformWeights) => {
      weights = loaded;
      resolver.updateConfig(config);
    });
    renderAll();
  };

  const stopConfigListener: () => void = deps.onConfigChanged(applyConfig);
  const stopSettingsListener: () => void = deps.onSettingsChanged((next: Settings) => {
    settings = next;
    renderAll();
    // Platform toggles and conservative mode reach the effective config through the background,
    // or through the local merge when it cannot answer.
    void deps.loadConfig().then(applyConfig);
  });
  applyConfig(config);

  return (): void => {
    stopConfigListener();
    stopSettingsListener();
    stopObserving?.();
    stopObserving = undefined;
    for (const element of [...entries.keys()]) detachPost(element);
    card.dispose();
    resolver.dispose();
  };
}
