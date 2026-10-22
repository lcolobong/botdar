/**
 * Loads the build's default weights tables and checks their shape once, so a typo in the JSON fails
 * at startup with a path instead of silently scoring as 0.
 *
 * The gates in docs/scoring-spec.md ("only if following >= 100", "Tier 2 delivered", ...) are not
 * encoded here. A gated feature is simply omitted by the platform's `toFeatures`, and an omitted
 * feature contributes nothing; the engine and these tables only see features that passed their gate.
 * `bsky.declaredBot` is likewise absent: it maps to `signals.declaredAutomated`, not to a weight.
 */

import type { PlatformId } from "../types";
import type {
  Bin,
  ConfidenceWeights,
  FeatureSpec,
  GroupCaps,
  PlatformWeights,
  TierThresholds,
  WeightsFile,
} from "./types";
import weightsJson from "./weights.default.json";

const PLATFORM_IDS: readonly PlatformId[] = ["x", "reddit", "bluesky"];
const GROUPS: ReadonlySet<string> = new Set([
  "age",
  "activity",
  "graph",
  "handle",
  "profile",
  "verification",
  "content",
  "geo",
]);

export class WeightsFileError extends Error {
  constructor(path: string, problem: string) {
    super(`Invalid weights file at ${path}: ${problem}`);
    this.name = "WeightsFileError";
  }
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WeightsFileError(path, "expected an object");
  }
  return value as JsonObject;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeightsFileError(path, "expected a finite number");
  }
  return value;
}

function asBound(value: unknown, path: string): number | null {
  return value === null ? null : asNumber(value, path);
}

function parseBin(value: unknown, path: string): Bin {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new WeightsFileError(path, "expected a [lo, hi, logOdds] triple");
  }
  const lo: number | null = asBound(value[0], `${path}[0]`);
  const hi: number | null = asBound(value[1], `${path}[1]`);
  if (lo !== null && hi !== null && lo >= hi) {
    throw new WeightsFileError(path, "lo must be below hi");
  }
  return [lo, hi, asNumber(value[2], `${path}[2]`)];
}

function parseFeatureSpec(value: unknown, path: string): FeatureSpec {
  const spec: JsonObject = asObject(value, path);
  const group: unknown = spec.group;
  if (typeof group !== "string" || !GROUPS.has(group)) {
    throw new WeightsFileError(`${path}.group`, "expected an independence group");
  }
  const cap: number = asNumber(spec.cap, `${path}.cap`);
  if (cap < 0) {
    throw new WeightsFileError(`${path}.cap`, "must not be negative");
  }
  const base = { group: group as FeatureSpec["group"], cap };
  if (spec.kind === "bool") {
    return { ...base, kind: "bool", weight: asNumber(spec.weight, `${path}.weight`) };
  }
  if (spec.kind === "bins") {
    if (!Array.isArray(spec.bins) || spec.bins.length === 0) {
      throw new WeightsFileError(`${path}.bins`, "expected a non-empty array");
    }
    const bins: Bin[] = spec.bins.map((bin, index) => parseBin(bin, `${path}.bins[${index}]`));
    return { ...base, kind: "bins", bins };
  }
  throw new WeightsFileError(`${path}.kind`, 'expected "bins" or "bool"');
}

function parseThresholds(value: unknown, path: string): TierThresholds {
  const thresholds: JsonObject = asObject(value, path);
  const some: number = asNumber(thresholds.some, `${path}.some`);
  const many: number = asNumber(thresholds.many, `${path}.many`);
  if (!(some < many)) {
    throw new WeightsFileError(path, "some must be below many");
  }
  return { some, many };
}

function parseGroupCaps(value: unknown, path: string): GroupCaps {
  const caps: GroupCaps = {};
  for (const [group, cap] of Object.entries(asObject(value, path))) {
    if (!GROUPS.has(group)) {
      throw new WeightsFileError(`${path}.${group}`, "unknown independence group");
    }
    caps[group as keyof GroupCaps] = asNumber(cap, `${path}.${group}`);
  }
  return caps;
}

function parseConfidenceWeights(value: unknown, path: string): ConfidenceWeights {
  const weights: JsonObject = asObject(value, path);
  const tierWeight = (tier: 0 | 1 | 2): number => {
    const weight: number = asNumber(weights[String(tier)], `${path}.${tier}`);
    if (weight < 0) {
      throw new WeightsFileError(`${path}.${tier}`, "must not be negative");
    }
    return weight;
  };
  return { 0: tierWeight(0), 1: tierWeight(1), 2: tierWeight(2) };
}

function parsePlatformWeights(value: unknown, path: string): PlatformWeights {
  const platform: JsonObject = asObject(value, path);
  const features: Record<string, FeatureSpec> = {};
  for (const [id, spec] of Object.entries(asObject(platform.features, `${path}.features`))) {
    features[id] = parseFeatureSpec(spec, `${path}.features.${id}`);
  }
  return {
    prior: asNumber(platform.prior, `${path}.prior`),
    thresholds: parseThresholds(platform.thresholds, `${path}.thresholds`),
    groupCaps: parseGroupCaps(platform.groupCaps, `${path}.groupCaps`),
    confidenceWeights: parseConfidenceWeights(
      platform.confidenceWeights,
      `${path}.confidenceWeights`,
    ),
    features,
  };
}

/** Validates an untrusted weights document; throws WeightsFileError naming the offending path. */
export function parseWeightsFile(input: unknown): WeightsFile {
  const file: JsonObject = asObject(input, "$");
  if (file.schema !== 1) {
    throw new WeightsFileError("$.schema", "expected 1");
  }
  const platformsJson: JsonObject = asObject(file.platforms, "$.platforms");
  const platforms: Partial<Record<PlatformId, PlatformWeights>> = {};
  for (const id of PLATFORM_IDS) {
    if (!(id in platformsJson)) {
      throw new WeightsFileError(`$.platforms.${id}`, "missing platform");
    }
    platforms[id] = parsePlatformWeights(platformsJson[id], `$.platforms.${id}`);
  }
  return { schema: 1, platforms: platforms as Record<PlatformId, PlatformWeights> };
}

export const defaultWeights: Record<PlatformId, PlatformWeights> =
  parseWeightsFile(weightsJson).platforms;
