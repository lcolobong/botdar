/**
 * The shape of the unsigned policy document (schema 1), as validatePolicy returns it. The signed
 * envelope that carries it is defined in verify.ts.
 */
import type { FeatureId } from "../types.ts";

export const POLICY_SCHEMA_VERSION = 1;

/** `[lo, hi, logOdds]`, half-open `[lo, hi)`, `null` = unbounded. Mirrors the scoring weights. */
export type PolicyBin = [lo: number | null, hi: number | null, logOdds: number];

export interface PolicyFeatureOverride {
  cap?: number;
  bins?: PolicyBin[];
  weight?: number;
}

export interface PolicyThresholds {
  some?: number;
  many?: number;
}

export interface PolicyTierSwitches {
  t1?: boolean;
  t2?: boolean;
}

export interface PolicyXOptions {
  /** The current X `AboutAccountQuery` GraphQL query id; X rotates it without notice. */
  aboutAccountQueryId?: string;
}

export interface PolicyPlatform {
  enabled: boolean;
  tiers?: PolicyTierSwitches;
  thresholds?: PolicyThresholds;
  prior?: number;
  features?: Record<FeatureId, PolicyFeatureOverride>;
  rateLimitPerMinute?: number;
  x?: PolicyXOptions;
}

export interface PolicyNotice {
  id: string;
  text: string;
  url?: string;
}

export interface Policy {
  schema: typeof POLICY_SCHEMA_VERSION;
  /** Monotonic; the loader rejects anything lower than the cached version (anti-rollback). */
  version: number;
  /** ISO 8601 timestamp. */
  issuedAt: string;
  /** Informational for operators; the extension does not gate on it because the merge is restrict-only. */
  minExtensionVersion: string;
  /** Keyed by platform id. Ids the build does not know are kept here and ignored by the merge. */
  platforms: Record<string, PolicyPlatform>;
  notice?: PolicyNotice;
}
