/**
 * Shape of the per-platform weights tables (src/core/scoring/weights.default.json) that the engine
 * scores against. See docs/scoring-spec.md "Configuration structure".
 */

import type { FeatureId, IndependenceGroup, PlatformId, SourceTier } from "../types";

/** `[lo, hi, logOdds]`: matches values in the half-open range `[lo, hi)`; `null` is unbounded. */
export type Bin = [lo: number | null, hi: number | null, logOdds: number];

interface FeatureSpecBase {
  group: IndependenceGroup;
  /** |contribution| never exceeds this, whatever the bins or weight say. */
  cap: number;
}

export interface BinsFeatureSpec extends FeatureSpecBase {
  kind: "bins";
  /** The first matching bin wins; a value matching none contributes 0. */
  bins: Bin[];
}

export interface BoolFeatureSpec extends FeatureSpecBase {
  kind: "bool";
  /** Contributed when the feature value is true; false contributes 0. */
  weight: number;
}

export type FeatureSpec = BinsFeatureSpec | BoolFeatureSpec;

/** Probability cut-offs for the `some` and `many` tiers. */
export interface TierThresholds {
  some: number;
  many: number;
}

/** Share of confidence each tier earns by delivering at least one field; need not sum to 1. */
export type ConfidenceWeights = Record<SourceTier, number>;

/** Cap on the summed positive contributions of a whole group, so weak signals cannot stack. */
export type GroupCaps = Partial<Record<IndependenceGroup, number>>;

export interface PlatformWeights {
  /** Log-odds before any evidence. */
  prior: number;
  thresholds: TierThresholds;
  groupCaps: GroupCaps;
  confidenceWeights: ConfidenceWeights;
  features: Record<FeatureId, FeatureSpec>;
}

export interface WeightsFile {
  schema: 1;
  platforms: Record<PlatformId, PlatformWeights>;
}
