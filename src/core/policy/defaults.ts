/**
 * Build defaults: the most the extension is ever allowed to do. The signed policy and the user's
 * settings can only narrow these (ADR-0007, ADR-0008). Feature caps, bins, thresholds and priors
 * live in the scoring weights and are handed to the merge at runtime.
 */
import type { PlatformId, TierSwitches } from "../types.ts";
import { deepFreeze } from "./freeze.ts";

export interface BuildPlatformDefaults {
  enabled: boolean;
  tiers: TierSwitches;
  /** Active (Tier 2) lookups per minute. */
  rateLimitPerMinute: number;
}

export type BuildDefaults = Record<PlatformId, BuildPlatformDefaults>;

export const platformIds: readonly PlatformId[] = Object.freeze([
  "x",
  "reddit",
  "bluesky",
  "hackernews",
]);

export function isPlatformId(value: string): value is PlatformId {
  return (platformIds as readonly string[]).includes(value);
}

export const buildDefaults: BuildDefaults = deepFreeze({
  x: { enabled: true, tiers: { t1: true, t2: true }, rateLimitPerMinute: 20 },
  reddit: { enabled: true, tiers: { t1: true, t2: true }, rateLimitPerMinute: 30 },
  bluesky: { enabled: true, tiers: { t1: true, t2: true }, rateLimitPerMinute: 30 },
  // Hacker News pages fetch no JSON of their own, so there is no Tier 1 to switch on.
  hackernews: { enabled: true, tiers: { t1: false, t2: true }, rateLimitPerMinute: 30 },
});
