/**
 * Turns a platform adapter's features into a Verdict. Implements docs/scoring-spec.md "Engine
 * algorithm" step by step; everything after the declared and empty short-circuits is pure.
 */

import type { AccountSignals, Evidence, Feature, SourceTier, Verdict, VerdictTier } from "../types";
import { applyGroupCaps, featureContribution } from "./contributions";
import {
  DECLARED_REASON,
  caveatFor,
  confidenceNoteFor,
  renderReason,
  selectReasons,
} from "./reasons";
import type { ConfidenceWeights, FeatureSpec, PlatformWeights, TierThresholds } from "./types";

export interface ScoreOptions {
  policyVersion: number;
  /** Epoch milliseconds; defaults to the wall clock. */
  now?: number;
  /** Tiers the effective config allows, so "not loaded yet" can be told apart from "switched off". */
  sourcesAvailable: SourceTier[];
}

const ALL_TIERS: readonly SourceTier[] = [0, 1, 2];

/** An evidence item counts towards the independence rule from this contribution upwards. */
const STRONG_CONTRIBUTION = 0.6;
const MANY_MIN_CONFIDENCE = 0.5;
const LOW_CONFIDENCE_BELOW = 0.4;
const CONFIDENCE_NOTE_BELOW = 0.7;

function logistic(logOdds: number): number {
  return 1 / (1 + Math.exp(-logOdds));
}

function deliveredTiers(signals: AccountSignals): SourceTier[] {
  const delivered = new Set<SourceTier>(Object.values(signals.provenance));
  return ALL_TIERS.filter((tier) => delivered.has(tier));
}

function confidenceFor(delivered: SourceTier[], confidenceWeights: ConfidenceWeights): number {
  const total: number = ALL_TIERS.reduce<number>((sum, tier) => sum + confidenceWeights[tier], 0);
  if (total <= 0) {
    return 0;
  }
  const earned: number = delivered.reduce<number>((sum, tier) => sum + confidenceWeights[tier], 0);
  return earned / total;
}

/**
 * Capped, sorted evidence with rendered reasons. Features the weights table does not know cannot
 * contribute and are dropped. Reasons render after the group caps because the age wording depends on
 * the sign of the final contribution.
 */
function evidenceFor(
  features: Feature[],
  signals: AccountSignals,
  weights: PlatformWeights,
  now: number,
): Evidence[] {
  const valueByFeature = new Map<string, number | boolean>();
  const uncapped: Evidence[] = [];
  for (const feature of features) {
    const spec: FeatureSpec | undefined = weights.features[feature.id];
    if (spec === undefined) {
      continue;
    }
    valueByFeature.set(feature.id, feature.value);
    uncapped.push({
      feature: feature.id,
      contribution: featureContribution(spec, feature.value),
      group: feature.group,
      tier: feature.tier,
      reason: "",
    });
  }
  return applyGroupCaps(uncapped, weights.groupCaps)
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
    .map((item) => ({
      ...item,
      reason: renderReason(item.feature, {
        value: valueByFeature.get(item.feature) ?? false,
        contribution: item.contribution,
        signals,
        now,
      }),
    }));
}

/** The independence rule: `many` needs two strong contributions from distinct groups (ADR-0003). */
function hasIndependentStrongEvidence(evidence: Evidence[]): boolean {
  const strongGroups = new Set(
    evidence.filter((item) => item.contribution >= STRONG_CONTRIBUTION).map((item) => item.group),
  );
  return strongGroups.size >= 2;
}

function bucket(
  probability: number,
  evidence: Evidence[],
  confidence: number,
  thresholds: TierThresholds,
): VerdictTier {
  if (
    probability >= thresholds.many &&
    hasIndependentStrongEvidence(evidence) &&
    confidence >= MANY_MIN_CONFIDENCE
  ) {
    return "many";
  }
  return probability >= thresholds.some ? "some" : "typical";
}

export function scoreAccount(
  features: Feature[],
  signals: AccountSignals,
  weights: PlatformWeights,
  options: ScoreOptions,
): Verdict {
  const now: number = options.now ?? Date.now();
  const sourcesUsed: SourceTier[] = deliveredTiers(signals);
  const expectedTiers: SourceTier[] = ALL_TIERS.filter(
    (tier) => weights.confidenceWeights[tier] > 0,
  );
  const sourcesMissing: SourceTier[] = expectedTiers.filter((tier) => !sourcesUsed.includes(tier));
  const unscored = {
    probability: logistic(weights.prior),
    logOdds: weights.prior,
    evidence: [],
    sourcesUsed,
    sourcesMissing,
    policyVersion: options.policyVersion,
    computedAt: now,
  };

  if (signals.declaredAutomated === true) {
    return {
      ...unscored,
      tier: "declared",
      reasons: [DECLARED_REASON],
      confidence: 1,
      caveat: caveatFor({
        tier: "declared",
        evidenceByMagnitude: [],
        signals,
        now,
        sourcesMissing,
      }),
      lowConfidence: false,
    };
  }

  const confidenceNote: string | undefined = confidenceNoteFor(
    sourcesMissing,
    options.sourcesAvailable,
  );
  if (features.length === 0) {
    return {
      ...unscored,
      tier: "unknown",
      reasons: [],
      confidence: 0,
      ...(confidenceNote === undefined ? {} : { confidenceNote }),
      caveat: caveatFor({ tier: "unknown", evidenceByMagnitude: [], signals, now, sourcesMissing }),
      lowConfidence: true,
    };
  }

  const evidence: Evidence[] = evidenceFor(features, signals, weights, now);
  const logOdds: number =
    weights.prior + evidence.reduce((sum, item) => sum + item.contribution, 0);
  const probability: number = logistic(logOdds);
  const confidence: number = confidenceFor(sourcesUsed, weights.confidenceWeights);
  const lowConfidence: boolean = confidence < LOW_CONFIDENCE_BELOW;

  const uncappedTier: VerdictTier = bucket(probability, evidence, confidence, weights.thresholds);
  const tier: VerdictTier = lowConfidence && uncappedTier === "many" ? "some" : uncappedTier;
  const attachedNote: string | undefined =
    confidence < CONFIDENCE_NOTE_BELOW ? confidenceNote : undefined;

  return {
    ...unscored,
    tier,
    probability,
    logOdds,
    evidence,
    reasons: selectReasons(evidence),
    confidence,
    ...(attachedNote === undefined ? {} : { confidenceNote: attachedNote }),
    caveat: caveatFor({ tier, evidenceByMagnitude: evidence, signals, now, sourcesMissing }),
    lowConfidence,
  };
}
