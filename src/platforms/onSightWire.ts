/**
 * Orchestration for the content scripts of platforms that have no Tier 1: Reddit and Hacker News,
 * which look every author up on sight (ADR-0020), and YouTube, which looks a commenter up only when
 * its badge is hovered (ADR-0030). It holds the effective config and settings, the
 * AccountResolver with the real scorer, one badge per discovered post and the single hover card.
 * An entrypoint only calls wireOnSight with its platform and the shadow-root stylesheet text it
 * bundled; everything with a side effect is injectable so the wiring is testable against fixture
 * pages with a fake scorer. Its parts live in src/platforms/onSight/: the contracts in types.ts,
 * the runtime loading and real scorer in runtime.ts, the hover card in hoverCard.ts and the badge
 * slot lifecycle in badgeSlots.ts.
 */
import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { TtlLruCache } from "../core/cache";
import { PersistedLookupStore } from "../core/persistedLookups";
import { onRequest } from "../core/messaging";
import { AccountResolver, TIER2_CACHE_CAPACITY, TIER2_CACHE_TTL_MS } from "../core/pipeline";
import { RateLimiter } from "../core/ratelimit";
import { onSettingsChanged } from "../core/settings";
import type { PartialSignals, PlatformAdapter } from "../core/types";
import type { HostTheme } from "../ui/mount";
import { detectHostTheme } from "../ui/mount";
import type { BadgeSlots } from "./onSight/badgeSlots";
import { createBadgeSlots } from "./onSight/badgeSlots";
import type { OnSightCard } from "./onSight/hoverCard";
import { mountOnSightCard } from "./onSight/hoverCard";
import { loadOnSightRuntime, realScorer } from "./onSight/runtime";
import type { OnSightPlatform, OnSightRuntime, WireOnSightOptions } from "./onSight/types";

export { loadOnSightRuntime } from "./onSight/runtime";
export type {
  OnSightPlatform,
  OnSightRuntime,
  ScorerFactory,
  WireOnSightOptions,
} from "./onSight/types";

/**
 * Authors are looked up as their posts come near the viewport (ADR-0020), and a first screen of a
 * thread holds ten or so distinct authors, so a burst of ten serves it at once; the rest follow at
 * the config's sustained rate (30 a minute by default), queued in the resolver.
 */
const LOOKUP_BURST = 10;

export async function wireOnSight(
  ctx: ContentScriptContext,
  shadowCss: string,
  platform: OnSightPlatform,
  options: WireOnSightOptions = {},
): Promise<() => void> {
  const adapter: PlatformAdapter = options.adapter ?? platform.adapter;
  const loadRuntime: () => Promise<OnSightRuntime> =
    options.loadRuntime ?? ((): Promise<OnSightRuntime> => loadOnSightRuntime(platform.platform));
  const openSettings: () => void =
    options.openSettings ?? ((): void => void browser.runtime.openOptionsPage());
  let runtime: OnSightRuntime = await loadRuntime();
  const looksUpOnSight: boolean = (platform.lookups ?? "onSight") === "onSight";
  const theme = (): HostTheme => detectHostTheme(platform.platform);

  const resolver = new AccountResolver({
    adapter,
    scorer: (options.scorer ?? realScorer)(() => runtime),
    config: runtime.config,
    // A lowered rate limit applies on the next page load; switching Tier 2 off applies at once.
    limiter: new RateLimiter({ perMinute: runtime.config.rateLimitPerMinute, burst: LOOKUP_BURST }),
    cache: new TtlLruCache<string, PartialSignals>(TIER2_CACHE_CAPACITY, TIER2_CACHE_TTL_MS),
    persistence: {
      store: new PersistedLookupStore(),
      enabled: () => runtime.settings.persistLookups,
    },
  });
  let stopObserving: (() => void) | null = null;

  // The card mounts first and the badges are built on it; the card is then bound to the badges,
  // before the feed is observed and so before any badge can be hovered.
  const card: OnSightCard = await mountOnSightCard({
    ctx,
    shadowCss,
    platform,
    runtime: () => runtime,
    theme,
    openSettings,
  });
  const badges: BadgeSlots = createBadgeSlots({
    ctx,
    shadowCss,
    adapter,
    resolver,
    runtime: () => runtime,
    theme,
    card,
    looksUpOnSight,
  });
  card.bindBadges(badges);

  // MARK: - Runtime changes

  const observeIfEnabled = (): void => {
    if (runtime.config.enabled && stopObserving === null) {
      stopObserving = adapter.observeFeed(badges.attachPost, badges.detachElement);
    } else if (!runtime.config.enabled && stopObserving !== null) {
      stopObserving();
      stopObserving = null;
      badges.detachAll();
    }
  };

  const applyRuntime = (next: OnSightRuntime): void => {
    runtime = next;
    resolver.updateConfig(next.config);
    observeIfEnabled();
    // Tier 2 coming back on (conservative mode off, a policy pause lifted) must not leave the posts
    // already on screen at "not looked up yet" until they scroll away and back; turning it off
    // dropped their queued lookups. lookupOnSight skips every account already read or tried, and
    // runs before the redraw so the badges come back as Checking.
    if (next.config.tiers.t2 && looksUpOnSight) {
      for (const slot of badges.all()) void slot.handle.lookupOnSight();
    }
    for (const slot of badges.all()) badges.syncBadge(slot);
    card.renderCard();
  };

  const stopConfigChanges: () => void = onRequest("config.changed", (message) => {
    void loadRuntime().then((fresh) =>
      applyRuntime({ ...fresh, config: message.configs[platform.platform] }),
    );
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
    badges.detachAll();
    card.controller.dispose();
    card.remove();
    resolver.dispose();
  };
  ctx.onInvalidated(dispose);
  return dispose;
}
