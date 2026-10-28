/**
 * The on-sight wiring's runtime: the effective config, weights and settings it starts from, and the
 * real scorer that reads them on every call so a config change applies without rewiring.
 */
import { sendRequest } from "@/src/core/messaging";
import { buildDefaults } from "@/src/core/policy/defaults";
import { loadLastKnownGood } from "@/src/core/policy/loader";
import { applyPolicy } from "@/src/core/policy/merge";
import { scoreAccount } from "@/src/core/scoring/engine";
import { defaultWeights } from "@/src/core/scoring/weights";
import { applySettings, loadSettings } from "@/src/core/settings";
import type { EffectivePlatformConfig, PlatformId, SourceTier } from "@/src/core/types";
import type { OnSightRuntime, ScorerFactory } from "./types";

/** Build defaults narrowed by the cached policy and the settings; the background's answer wins for the config. */
export async function loadOnSightRuntime(platform: PlatformId): Promise<OnSightRuntime> {
  const [cached, settings] = await Promise.all([loadLastKnownGood(), loadSettings()]);
  const effective = applySettings(
    applyPolicy(buildDefaults, defaultWeights, cached?.policy ?? null),
    settings,
  );
  let config: EffectivePlatformConfig = effective.platforms[platform];
  try {
    config = (await sendRequest({ type: "config.get", platform })).config;
  } catch {
    // The background broker is the authority once it serves config.get; until then the local
    // merge above is the same computation on the same stored policy.
  }
  return { config, weights: effective.weights[platform], settings };
}

function allowedTiers(config: EffectivePlatformConfig): SourceTier[] {
  const tiers: SourceTier[] = [0];
  if (config.tiers.t1) tiers.push(1);
  if (config.tiers.t2) tiers.push(2);
  return tiers;
}

export const realScorer: ScorerFactory = (runtime) => (features, signals) =>
  scoreAccount(features, signals, runtime().weights, {
    policyVersion: runtime().config.policyVersion,
    sourcesAvailable: allowedTiers(runtime().config),
  });
