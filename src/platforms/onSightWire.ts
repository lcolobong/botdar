/**
 * Orchestration for the content scripts of platforms that have no Tier 1: Reddit and Hacker News,
 * which look every author up on sight (ADR-0020), and YouTube, which looks a commenter up only when
 * its badge is hovered (ADR-0030). It holds the effective config and settings, the
 * AccountResolver with the real scorer, one badge per discovered post and the single hover card.
 * An entrypoint only calls wireOnSight with its platform and the shadow-root stylesheet text it
 * bundled; everything with a side effect is injectable so the wiring is testable against fixture
 * pages with a fake scorer. The contracts are in onSight/types.ts, the runtime loading and real
 * scorer in onSight/runtime.ts, and the hover card in onSight/hoverCard.ts.
 */
import { h, render } from "preact";
import { kindOfPost, recordBadged } from "../core/diagnostics.ts";
import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { TtlLruCache } from "../core/cache";
import { PersistedLookupStore } from "../core/persistedLookups";
import { onRequest } from "../core/messaging";
import type { BadgeHandle } from "../core/pipeline";
import { AccountResolver, TIER2_CACHE_TTL_MS } from "../core/pipeline";
import { RateLimiter } from "../core/ratelimit";
import { onSettingsChanged } from "../core/settings";
import type { PartialSignals, PlatformAdapter, PostRef } from "../core/types";
import { Badge } from "../ui/Badge";
import { shouldDrawBadge } from "../ui/labels";
import type { HostTheme } from "../ui/mount";
import { detectHostTheme, mountBadge } from "../ui/mount";
import type { OnSightCard } from "./onSight/hoverCard";
import { isLookingUp, mountOnSightCard } from "./onSight/hoverCard";
import { loadOnSightRuntime, realScorer } from "./onSight/runtime";
import type {
  BadgeSlot,
  OnSightPlatform,
  OnSightRuntime,
  WireOnSightOptions,
} from "./onSight/types";

export { CARD_ID } from "./onSight/hoverCard";
export { loadOnSightRuntime } from "./onSight/runtime";
export type {
  OnSightPlatform,
  OnSightRuntime,
  ScorerFactory,
  WireOnSightOptions,
} from "./onSight/types";

const CACHE_CAPACITY = 500;
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
    cache: new TtlLruCache<string, PartialSignals>(CACHE_CAPACITY, TIER2_CACHE_TTL_MS),
    persistence: {
      store: new PersistedLookupStore(),
      enabled: () => runtime.settings.persistLookups,
    },
  });
  const slots = new Map<Element, BadgeSlot>();
  const slotByHost = new WeakMap<Element, BadgeSlot>();
  let stopObserving: (() => void) | null = null;

  // MARK: - Hover card

  const card: OnSightCard = await mountOnSightCard({
    ctx,
    shadowCss,
    platform,
    runtime: () => runtime,
    theme,
    openSettings,
  });

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
        loading: isLookingUp(slot),
        stillWhileLoading: !card.isOpen(slot),
        glyphOnlyAtCommentDensity: runtime.settings.redditCommentLabels !== "label",
        onOpen: () => {
          if (slot.mounted !== null) card.controller.requestOpen(slot.mounted.shadowHost);
        },
        onClose: () => card.controller.requestClose(),
      }),
      container,
    );
  };

  const unmountBadge = (slot: BadgeSlot): void => {
    if (slot.mounted === null) return;
    if (card.isOpen(slot)) card.controller.closeNow();
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
      if (card.isOpen(slot)) card.renderCard();
    });
    syncBadge(slot);
    // Observers attach a post only near the viewport (ADR-0019), so this is a lookup on sight. It
    // comes after the subscription: a cache hit rescores synchronously, and a badge subscribed
    // later would keep drawing the Tier 0 verdict it read first.
    if (looksUpOnSight) void handle.lookupOnSight();
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

  // The card mounted before any badge existed; it reaches them from here on.
  card.bindBadges({ slotAtHost: (host) => slotByHost.get(host), renderBadge });

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

  const applyRuntime = (next: OnSightRuntime): void => {
    runtime = next;
    resolver.updateConfig(next.config);
    observeIfEnabled();
    // Tier 2 coming back on (conservative mode off, a policy pause lifted) must not leave the posts
    // already on screen at "not looked up yet" until they scroll away and back; turning it off
    // dropped their queued lookups. lookupOnSight skips every account already read or tried, and
    // runs before the redraw so the badges come back as Checking.
    if (next.config.tiers.t2 && looksUpOnSight) {
      for (const slot of slots.values()) void slot.handle.lookupOnSight();
    }
    for (const slot of slots.values()) syncBadge(slot);
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
    for (const element of [...slots.keys()]) detachElement(element);
    card.controller.dispose();
    card.remove();
    resolver.dispose();
  };
  ctx.onInvalidated(dispose);
  return dispose;
}
