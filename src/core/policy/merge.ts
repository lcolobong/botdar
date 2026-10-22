/**
 * The restrict-only merge: build defaults narrowed by a verified policy. Every rule here is a
 * one-way door; a valid, correctly signed policy can switch things off, lower caps and limits and
 * move the prior toward "typical", but never the reverse. A leaked signing key or a hijacked host
 * therefore gets a kill switch and nothing more (ADR-0007, docs/architecture.md "Threat model").
 */
import type { EffectivePlatformConfig, FeatureId, PlatformId } from "../types.ts";
import type { BuildDefaults, BuildPlatformDefaults } from "./defaults.ts";
import { platformIds } from "./defaults.ts";
import { deepFreeze } from "./freeze.ts";
import type {
  Policy,
  PolicyBin,
  PolicyFeatureOverride,
  PolicyNotice,
  PolicyPlatform,
  PolicyThresholds,
} from "./schema.ts";

/** The subset of a scoring feature spec the policy may touch; other fields pass through untouched. */
export interface FeatureWeights {
  cap: number;
  bins?: PolicyBin[];
  weight?: number;
}

export interface Thresholds {
  some: number;
  many: number;
}

/** The subset of a platform's scoring weights the policy may touch; other fields pass through. */
export interface PlatformWeights {
  prior: number;
  thresholds: Thresholds;
  features: Record<FeatureId, FeatureWeights>;
}

export interface EffectiveConfig<W extends PlatformWeights = PlatformWeights> {
  policyVersion: number;
  platforms: Record<PlatformId, EffectivePlatformConfig>;
  weights: Record<PlatformId, W>;
  notice?: PolicyNotice;
}

export const THRESHOLD_MIN = 0.15;
export const THRESHOLD_MAX = 0.95;
/** `many` must sit at least this far above `some`. */
export const THRESHOLD_GAP = 0.1;
export const PRIOR_MIN = -5;
export const PRIOR_MAX = 0;
export const ABOUT_ACCOUNT_QUERY_ID_PATTERN = /^[A-Za-z0-9_-]{15,40}$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mergePlatformConfig(
  platform: PlatformId,
  build: BuildPlatformDefaults,
  override: PolicyPlatform | undefined,
  policyVersion: number,
): EffectivePlatformConfig {
  const config: EffectivePlatformConfig = {
    platform,
    enabled: build.enabled && (override?.enabled ?? true),
    tiers: {
      t1: build.tiers.t1 && (override?.tiers?.t1 ?? true),
      t2: build.tiers.t2 && (override?.tiers?.t2 ?? true),
    },
    rateLimitPerMinute: Math.min(
      build.rateLimitPerMinute,
      override?.rateLimitPerMinute ?? build.rateLimitPerMinute,
    ),
    policyVersion,
  };
  const queryId: string | undefined = override?.x?.aboutAccountQueryId;
  if (platform === "x" && queryId !== undefined && ABOUT_ACCOUNT_QUERY_ID_PATTERN.test(queryId)) {
    config.aboutAccountQueryId = queryId;
  }
  return config;
}

function mergeThresholds(build: Thresholds, override: PolicyThresholds | undefined): Thresholds {
  if (override === undefined) return { ...build };
  const some: number = clamp(
    override.some ?? build.some,
    THRESHOLD_MIN,
    THRESHOLD_MAX - THRESHOLD_GAP,
  );
  const many: number = clamp(override.many ?? build.many, some + THRESHOLD_GAP, THRESHOLD_MAX);
  return { some, many };
}

function mergeFeature(
  build: FeatureWeights,
  override: PolicyFeatureOverride | undefined,
): FeatureWeights {
  const cap: number = override?.cap === undefined ? build.cap : Math.min(build.cap, override.cap);
  const merged: FeatureWeights = { ...build, cap };
  // A policy cannot change a feature's kind: bins only replace bins, a weight only replaces a weight.
  const bins: PolicyBin[] | undefined =
    build.bins === undefined ? undefined : (override?.bins ?? build.bins);
  if (bins !== undefined) {
    merged.bins = bins.map(([lo, hi, logOdds]): PolicyBin => [lo, hi, clamp(logOdds, -cap, cap)]);
  }
  const weight: number | undefined =
    build.weight === undefined ? undefined : (override?.weight ?? build.weight);
  if (weight !== undefined) merged.weight = clamp(weight, -cap, cap);
  return merged;
}

function mergeWeights<W extends PlatformWeights>(
  build: W,
  override: PolicyPlatform | undefined,
): W {
  const features: Record<FeatureId, FeatureWeights> = {};
  for (const [featureId, buildFeature] of Object.entries(build.features)) {
    features[featureId] = mergeFeature(buildFeature, override?.features?.[featureId]);
  }
  const prior: number =
    override?.prior === undefined
      ? build.prior
      : Math.min(build.prior, clamp(override.prior, PRIOR_MIN, PRIOR_MAX));
  return {
    ...build,
    prior,
    thresholds: mergeThresholds(build.thresholds, override?.thresholds),
    features,
  };
}

/** Narrows the build defaults and weights by the policy; `null` yields the defaults. Result is frozen. */
export function applyPolicy<W extends PlatformWeights>(
  defaults: BuildDefaults,
  weightsByPlatform: Record<PlatformId, W>,
  policy: Policy | null,
): EffectiveConfig<W> {
  const policyVersion: number = policy?.version ?? 0;
  const platforms: Partial<Record<PlatformId, EffectivePlatformConfig>> = {};
  const weights: Partial<Record<PlatformId, W>> = {};
  for (const platform of platformIds) {
    const override: PolicyPlatform | undefined = policy?.platforms[platform];
    platforms[platform] = mergePlatformConfig(
      platform,
      defaults[platform],
      override,
      policyVersion,
    );
    weights[platform] = mergeWeights(weightsByPlatform[platform], override);
  }
  const effective: EffectiveConfig<W> = {
    policyVersion,
    platforms: platforms as Record<PlatformId, EffectivePlatformConfig>,
    weights: weights as Record<PlatformId, W>,
  };
  if (policy?.notice !== undefined) effective.notice = { ...policy.notice };
  return deepFreeze(effective);
}
