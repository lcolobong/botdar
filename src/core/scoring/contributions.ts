import type { IndependenceGroup } from "../types";
import type { Bin, FeatureSpec, GroupCaps } from "./types";

type FeatureValue = number | boolean;

function binMatches(bin: Bin, value: number): boolean {
  const [lo, hi] = bin;
  return (lo === null || value >= lo) && (hi === null || value < hi);
}

/** The bin value or bool weight for `value`, before any cap. A value of the wrong type contributes 0. */
export function rawContribution(spec: FeatureSpec, value: FeatureValue): number {
  if (spec.kind === "bool") {
    return value === true ? spec.weight : 0;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  const matchingBin: Bin | undefined = spec.bins.find((bin) => binMatches(bin, value));
  return matchingBin === undefined ? 0 : matchingBin[2];
}

export function clampToCap(contribution: number, cap: number): number {
  const absoluteCap: number = Math.abs(cap);
  return Math.min(absoluteCap, Math.max(-absoluteCap, contribution));
}

/** Per-feature contribution: lookup, then clamped to ±cap. Group caps are a separate pass. */
export function featureContribution(spec: FeatureSpec, value: FeatureValue): number {
  return clampToCap(rawContribution(spec, value), spec.cap);
}

export interface GroupedContribution {
  group: IndependenceGroup;
  contribution: number;
}

/**
 * Scales the positive contributions of each capped group down proportionally when their sum exceeds
 * the group's cap. Negative contributions are left untouched and do not offset the sum.
 */
export function applyGroupCaps<T extends GroupedContribution>(
  items: T[],
  groupCaps: GroupCaps,
): T[] {
  const positiveSumByGroup = new Map<IndependenceGroup, number>();
  for (const item of items) {
    if (item.contribution > 0) {
      positiveSumByGroup.set(
        item.group,
        (positiveSumByGroup.get(item.group) ?? 0) + item.contribution,
      );
    }
  }

  const scaleByGroup = new Map<IndependenceGroup, number>();
  for (const [group, positiveSum] of positiveSumByGroup) {
    const cap: number | undefined = groupCaps[group];
    if (cap !== undefined && positiveSum > cap) {
      scaleByGroup.set(group, cap / positiveSum);
    }
  }

  return items.map((item) => {
    const scale: number | undefined = scaleByGroup.get(item.group);
    if (scale === undefined || item.contribution <= 0) {
      return item;
    }
    return { ...item, contribution: item.contribution * scale };
  });
}
