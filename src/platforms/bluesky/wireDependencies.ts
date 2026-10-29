import { browser } from "wxt/browser";
import { onRequest, sendRequest } from "../../core/messaging";
import { recordFeedback, removeFeedback } from "../../core/feedback";
import { getEffectiveConfig } from "../../core/policy/loader";
import { scoreAccount } from "../../core/scoring/engine";
import type { PlatformWeights } from "../../core/scoring/types";
import { defaultWeights } from "../../core/scoring/weights";
import { loadSettings, onSettingsChanged } from "../../core/settings";
import type { Settings } from "../../core/settings";
import type { EffectivePlatformConfig, PlatformAdapter, SourceTier } from "../../core/types";
import { createBlueskyAdapter } from "./adapter";

export const PLATFORM = "bluesky";

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

export function enabledTiers(config: EffectivePlatformConfig): SourceTier[] {
  const tiers: SourceTier[] = [0];
  if (config.tiers.t1) tiers.push(1);
  if (config.tiers.t2) tiers.push(2);
  return tiers;
}
