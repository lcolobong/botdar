/**
 * The unsigned policy document (schema 1) and its validator. The document's types live in
 * policyDocument.ts and are re-exported here; the signed envelope that carries it is defined in
 * verify.ts, and the restrict-only merge that interprets it is in merge.ts.
 *
 * Validation is strict on purpose: an unknown key anywhere except under `platforms` and `features`
 * (whose keys are ids) rejects the whole document, so a typo in the source can never silently turn a
 * kill switch into a no-op. The validator checks types and structural ranges only; the restrict-only
 * clamps live in the merge so that a valid document can still never enable anything.
 * See docs/architecture.md ("Policy system") and docs/decisions/ADR-0007.
 */
import type { FeatureId } from "../types.ts";
import { POLICY_SCHEMA_VERSION } from "./policyDocument.ts";
import type {
  Policy,
  PolicyBin,
  PolicyFeatureOverride,
  PolicyNotice,
  PolicyPlatform,
  PolicyThresholds,
  PolicyTierSwitches,
  PolicyXOptions,
} from "./policyDocument.ts";

export { POLICY_SCHEMA_VERSION } from "./policyDocument.ts";
export type {
  Policy,
  PolicyBin,
  PolicyFeatureOverride,
  PolicyNotice,
  PolicyPlatform,
  PolicyThresholds,
  PolicyTierSwitches,
  PolicyXOptions,
} from "./policyDocument.ts";

export class PolicyValidationError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = "PolicyValidationError";
    this.path = path;
  }
}

const MAX_BINS_PER_FEATURE = 32;
const MAX_FEATURES_PER_PLATFORM = 64;
const MAX_PLATFORMS = 16;
const MAX_RATE_LIMIT_PER_MINUTE = 600;
const MAX_ID_LENGTH = 64;
const MAX_NOTICE_TEXT_LENGTH = 500;
const MAX_URL_LENGTH = 500;
const EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const TOP_LEVEL_KEYS = [
  "schema",
  "version",
  "issuedAt",
  "minExtensionVersion",
  "platforms",
  "notice",
];
const PLATFORM_KEYS = [
  "enabled",
  "tiers",
  "thresholds",
  "prior",
  "features",
  "rateLimitPerMinute",
  "x",
];
const TIER_KEYS = ["t1", "t2"];
const THRESHOLD_KEYS = ["some", "many"];
const FEATURE_KEYS = ["cap", "bins", "weight"];
const X_KEYS = ["aboutAccountQueryId"];
const NOTICE_KEYS = ["id", "text", "url"];

function fail(path: string, detail: string): never {
  throw new PolicyValidationError(path, detail);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function asRecordWithKeys(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const record: Record<string, unknown> = asRecord(value, path);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) fail(`${path}.${key}`, "unknown key");
  }
  return record;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function asFiniteNumber(value: unknown, path: string, min?: number, max?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
  if (min !== undefined && value < min) fail(path, `expected a number >= ${min}`);
  if (max !== undefined && value > max) fail(path, `expected a number <= ${max}`);
  return value;
}

function asInteger(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(path, "expected an integer");
  if (value < min || value > max) fail(path, `expected an integer in [${min}, ${max}]`);
  return value;
}

function asString(value: unknown, path: string, maxLength: number, pattern?: RegExp): string {
  if (typeof value !== "string") fail(path, "expected a string");
  if (value.length === 0) fail(path, "expected a non-empty string");
  if (value.length > maxLength) fail(path, `expected at most ${maxLength} characters`);
  if (pattern !== undefined && !pattern.test(value)) fail(path, `expected to match ${pattern}`);
  return value;
}

function asTimestamp(value: unknown, path: string): string {
  const text: string = asString(value, path, MAX_ID_LENGTH);
  if (Number.isNaN(Date.parse(text))) fail(path, "expected an ISO 8601 timestamp");
  return text;
}

function asHttpsUrl(value: unknown, path: string): string {
  const text: string = asString(value, path, MAX_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    fail(path, "expected an absolute URL");
  }
  if (parsed.protocol !== "https:") fail(path, "expected an https URL");
  return text;
}

function asBin(value: unknown, path: string): PolicyBin {
  if (!Array.isArray(value) || value.length !== 3) fail(path, "expected [lo, hi, logOdds]");
  const lo: number | null = value[0] === null ? null : asFiniteNumber(value[0], `${path}[0]`);
  const hi: number | null = value[1] === null ? null : asFiniteNumber(value[1], `${path}[1]`);
  const logOdds: number = asFiniteNumber(value[2], `${path}[2]`);
  if (lo !== null && hi !== null && lo >= hi) fail(path, "expected lo < hi");
  return [lo, hi, logOdds];
}

function asBins(value: unknown, path: string): PolicyBin[] {
  if (!Array.isArray(value)) fail(path, "expected an array of bins");
  if (value.length > MAX_BINS_PER_FEATURE)
    fail(path, `expected at most ${MAX_BINS_PER_FEATURE} bins`);
  return value.map((bin: unknown, index: number) => asBin(bin, `${path}[${index}]`));
}

function asFeatureOverride(value: unknown, path: string): PolicyFeatureOverride {
  const record: Record<string, unknown> = asRecordWithKeys(value, path, FEATURE_KEYS);
  const override: PolicyFeatureOverride = {};
  if (record.cap !== undefined) override.cap = asFiniteNumber(record.cap, `${path}.cap`, 0);
  if (record.bins !== undefined) override.bins = asBins(record.bins, `${path}.bins`);
  if (record.weight !== undefined)
    override.weight = asFiniteNumber(record.weight, `${path}.weight`);
  return override;
}

function asFeatures(value: unknown, path: string): Record<FeatureId, PolicyFeatureOverride> {
  const record: Record<string, unknown> = asRecord(value, path);
  const entries: [string, unknown][] = Object.entries(record);
  if (entries.length > MAX_FEATURES_PER_PLATFORM) {
    fail(path, `expected at most ${MAX_FEATURES_PER_PLATFORM} features`);
  }
  const features: Record<FeatureId, PolicyFeatureOverride> = {};
  for (const [featureId, override] of entries) {
    asString(featureId, `${path}.${featureId}`, MAX_ID_LENGTH);
    features[featureId] = asFeatureOverride(override, `${path}.${featureId}`);
  }
  return features;
}

function asTiers(value: unknown, path: string): PolicyTierSwitches {
  const record: Record<string, unknown> = asRecordWithKeys(value, path, TIER_KEYS);
  const tiers: PolicyTierSwitches = {};
  if (record.t1 !== undefined) tiers.t1 = asBoolean(record.t1, `${path}.t1`);
  if (record.t2 !== undefined) tiers.t2 = asBoolean(record.t2, `${path}.t2`);
  return tiers;
}

function asThresholds(value: unknown, path: string): PolicyThresholds {
  const record: Record<string, unknown> = asRecordWithKeys(value, path, THRESHOLD_KEYS);
  const thresholds: PolicyThresholds = {};
  if (record.some !== undefined)
    thresholds.some = asFiniteNumber(record.some, `${path}.some`, 0, 1);
  if (record.many !== undefined)
    thresholds.many = asFiniteNumber(record.many, `${path}.many`, 0, 1);
  return thresholds;
}

function asXOptions(value: unknown, path: string): PolicyXOptions {
  const record: Record<string, unknown> = asRecordWithKeys(value, path, X_KEYS);
  const options: PolicyXOptions = {};
  if (record.aboutAccountQueryId !== undefined) {
    options.aboutAccountQueryId = asString(
      record.aboutAccountQueryId,
      `${path}.aboutAccountQueryId`,
      MAX_ID_LENGTH,
    );
  }
  return options;
}

function asPlatform(value: unknown, path: string): PolicyPlatform {
  const record: Record<string, unknown> = asRecordWithKeys(value, path, PLATFORM_KEYS);
  const platform: PolicyPlatform = { enabled: asBoolean(record.enabled, `${path}.enabled`) };
  if (record.tiers !== undefined) platform.tiers = asTiers(record.tiers, `${path}.tiers`);
  if (record.thresholds !== undefined) {
    platform.thresholds = asThresholds(record.thresholds, `${path}.thresholds`);
  }
  if (record.prior !== undefined) platform.prior = asFiniteNumber(record.prior, `${path}.prior`);
  if (record.features !== undefined) {
    platform.features = asFeatures(record.features, `${path}.features`);
  }
  if (record.rateLimitPerMinute !== undefined) {
    platform.rateLimitPerMinute = asInteger(
      record.rateLimitPerMinute,
      `${path}.rateLimitPerMinute`,
      0,
      MAX_RATE_LIMIT_PER_MINUTE,
    );
  }
  if (record.x !== undefined) platform.x = asXOptions(record.x, `${path}.x`);
  return platform;
}

function asPlatforms(value: unknown, path: string): Record<string, PolicyPlatform> {
  const record: Record<string, unknown> = asRecord(value, path);
  const entries: [string, unknown][] = Object.entries(record);
  if (entries.length > MAX_PLATFORMS) fail(path, `expected at most ${MAX_PLATFORMS} platforms`);
  const platforms: Record<string, PolicyPlatform> = {};
  for (const [platformId, platform] of entries) {
    asString(platformId, `${path}.${platformId}`, MAX_ID_LENGTH);
    platforms[platformId] = asPlatform(platform, `${path}.${platformId}`);
  }
  return platforms;
}

function asNotice(value: unknown, path: string): PolicyNotice {
  const record: Record<string, unknown> = asRecordWithKeys(value, path, NOTICE_KEYS);
  const notice: PolicyNotice = {
    id: asString(record.id, `${path}.id`, MAX_ID_LENGTH),
    text: asString(record.text, `${path}.text`, MAX_NOTICE_TEXT_LENGTH),
  };
  if (record.url !== undefined) notice.url = asHttpsUrl(record.url, `${path}.url`);
  return notice;
}

/** Returns a plain copy holding only known keys, or throws a PolicyValidationError naming the path. */
export function validatePolicy(input: unknown): Policy {
  const record: Record<string, unknown> = asRecordWithKeys(input, "policy", TOP_LEVEL_KEYS);
  if (record.schema !== POLICY_SCHEMA_VERSION) {
    fail("policy.schema", `expected ${POLICY_SCHEMA_VERSION}`);
  }
  const policy: Policy = {
    schema: POLICY_SCHEMA_VERSION,
    version: asInteger(record.version, "policy.version", 1, Number.MAX_SAFE_INTEGER),
    issuedAt: asTimestamp(record.issuedAt, "policy.issuedAt"),
    minExtensionVersion: asString(
      record.minExtensionVersion,
      "policy.minExtensionVersion",
      MAX_ID_LENGTH,
      EXTENSION_VERSION_PATTERN,
    ),
    platforms: asPlatforms(record.platforms, "policy.platforms"),
  };
  if (record.notice !== undefined) policy.notice = asNotice(record.notice, "policy.notice");
  return policy;
}
