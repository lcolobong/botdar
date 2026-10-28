/**
 * The unsigned policy document (schema 1) and its validator. The types live in policyDocument.ts
 * and the validator in validatePolicy.ts; this module re-exports both so callers keep one import.
 */
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
export { PolicyValidationError, validatePolicy } from "./validatePolicy.ts";
