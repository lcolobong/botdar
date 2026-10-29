import tokensCss from "../src/ui/tokens.css?inline";
import badgeCss from "../src/ui/badge.css?inline";
import cardCss from "../src/ui/card.css?inline";
import { TtlLruCache } from "../src/core/cache.ts";
import { PersistedLookupStore } from "../src/core/persistedLookups.ts";
import { recordFeedback, removeFeedback } from "../src/core/feedback.ts";
import { registerDiagnosticsHandlers } from "../src/core/diagnosticsHandlers.ts";
import { onRequest, sendRequest } from "../src/core/messaging.ts";
import { AccountResolver, TIER2_CACHE_CAPACITY, TIER2_CACHE_TTL_MS } from "../src/core/pipeline.ts";
import type { Scorer } from "../src/core/pipeline.ts";
import { getEffectiveConfig } from "../src/core/policy/loader.ts";
import type { EffectiveConfig } from "../src/core/policy/merge.ts";
import { RateLimiter } from "../src/core/ratelimit.ts";
import { scoreAccount } from "../src/core/scoring/engine.ts";
import type { PlatformWeights } from "../src/core/scoring/types.ts";
import { defaultWeights } from "../src/core/scoring/weights.ts";
import { loadSettings, onSettingsChanged } from "../src/core/settings.ts";
import type { Settings } from "../src/core/settings.ts";
import type { EffectivePlatformConfig, PartialSignals } from "../src/core/types.ts";
import { shadowStyles } from "../src/ui/mount.ts";
import { createXAdapter } from "../src/platforms/x/adapter.ts";
import { markBadged, unmarkBadged } from "../src/platforms/x/dom.ts";
import { QueryIdRegistry } from "../src/platforms/x/queryIds.ts";
import { wirePlatform } from "../src/platforms/x/wire.ts";
import type { PlatformWiring } from "../src/platforms/x/wire.ts";

const LOOKUP_BURST = 3;

interface EffectiveX {
  config: EffectivePlatformConfig;
  weights: PlatformWeights;
}

/**
 * The platform config comes from the background broker when it answers; the weights, and the
 * config when the broker is silent, come from the same local merge of build defaults, cached
 * policy and settings that the background runs.
 */
async function loadEffectiveX(): Promise<EffectiveX> {
  const effective: EffectiveConfig<PlatformWeights> = await getEffectiveConfig(defaultWeights);
  let config: EffectivePlatformConfig = effective.platforms.x;
  try {
    config = (await sendRequest({ type: "config.get", platform: "x" })).config;
  } catch {
    // No broker in this build, or a malformed answer: the local merge stands.
  }
  return { config, weights: effective.weights.x };
}

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  // "manual" keeps the stylesheets inside the bundle (imported with `?inline`); "ui" would fetch
  // them at runtime and list them under web_accessible_resources, which ADR-0013 forbids.
  cssInjectionMode: "manual",
  runAt: "document_idle",
  async main(ctx) {
    // Before the first await, so the popup's diagnostics answer even when wiring stalls or fails.
    ctx.onInvalidated(registerDiagnosticsHandlers("x"));
    const registry = new QueryIdRegistry();
    const stopRegistry: () => void = registry.startObserving();
    let settings: Settings = await loadSettings();
    let effective: EffectiveX = await loadEffectiveX();

    const scorer: Scorer = (features, signals, sourcesAvailable) =>
      scoreAccount(features, signals, effective.weights, {
        policyVersion: effective.config.policyVersion,
        sourcesAvailable,
      });
    const adapter = createXAdapter({ registry });
    const resolver = new AccountResolver({
      adapter,
      scorer,
      config: effective.config,
      limiter: new RateLimiter({
        perMinute: effective.config.rateLimitPerMinute,
        burst: LOOKUP_BURST,
      }),
      cache: new TtlLruCache<string, PartialSignals>(TIER2_CACHE_CAPACITY, TIER2_CACHE_TTL_MS),
      persistence: { store: new PersistedLookupStore(), enabled: () => settings.persistLookups },
    });
    const wiring: PlatformWiring = wirePlatform({
      ctx,
      adapter,
      resolver,
      shadowCss: shadowStyles(tokensCss, badgeCss, cardCss),
      settings: () => settings,
      config: () => effective.config,
      markBadged,
      unmarkBadged,
      recordFeedback,
      removeFeedback,
      openSettings: () => void browser.runtime.openOptionsPage(),
      handlePrefix: "@",
    });

    const applyEffective = (next: EffectiveX): void => {
      effective = next;
      resolver.updateConfig(next.config);
      wiring.refresh();
    };
    const stopConfigChanged: () => void = onRequest("config.changed", (message) => {
      void getEffectiveConfig(defaultWeights).then((merged) =>
        applyEffective({ config: message.configs.x, weights: merged.weights.x }),
      );
      return undefined;
    });
    const stopSettingsChanged: () => void = onSettingsChanged((next) => {
      settings = next;
      void loadEffectiveX().then(applyEffective);
    });
    const stopObserving: () => void = adapter.observeFeed(wiring.attach, wiring.release);

    ctx.onInvalidated(() => {
      stopObserving();
      stopSettingsChanged();
      stopConfigChanged();
      stopRegistry();
      wiring.stop();
      resolver.dispose();
    });
  },
});
