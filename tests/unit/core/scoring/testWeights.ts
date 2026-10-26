import type { PlatformWeights } from "@/src/core/scoring/types";
import type { AccountSignals, Feature, SignalField, SourceTier } from "@/src/core/types";

/** An X-shaped table with a second activity feature so same-group stacking can be exercised. */
export const testWeights: PlatformWeights = {
  prior: -2.5,
  thresholds: { some: 0.3, many: 0.6 },
  groupCaps: { handle: 1.2, profile: 1.2 },
  confidenceWeights: { 0: 0.25, 1: 0.55, 2: 0.2 },
  features: {
    "x.postsPerDay": {
      group: "activity",
      cap: 2.0,
      kind: "bins",
      bins: [
        [0, 10, 0],
        [10, 30, 0.4],
        [30, 75, 1.0],
        [75, 150, 1.5],
        [150, null, 2.0],
      ],
    },
    "x.likesPerDay": {
      group: "activity",
      cap: 2.0,
      kind: "bins",
      bins: [
        [0, 100, 0],
        [100, null, 2.0],
      ],
    },
    "x.accountAgeDays": {
      group: "age",
      cap: 1.5,
      kind: "bins",
      bins: [
        [0, 30, 1.5],
        [30, 90, 0.8],
        [90, 365, 0.2],
        [365, null, -0.5],
      ],
    },
    "x.followingRatio": {
      group: "graph",
      cap: 1.5,
      kind: "bins",
      bins: [
        [0, 1, -0.3],
        [1, 5, 0],
        [5, 20, 0.6],
        [20, 100, 1.0],
        [100, null, 1.5],
      ],
    },
    "x.handleNameDigits": { group: "handle", cap: 0.7, kind: "bool", weight: 0.7 },
    "x.handleTrailingDigits": {
      group: "handle",
      cap: 0.5,
      kind: "bins",
      bins: [
        [0, 5, 0],
        [5, null, 0.5],
      ],
    },
    "x.handleBigramLL": {
      group: "handle",
      cap: 0.8,
      kind: "bins",
      bins: [
        [null, -4.5, 0.8],
        [-4.5, -3.8, 0.4],
        [-3.8, null, 0],
      ],
    },
    "x.defaultAvatarEmptyBio": {
      group: "profile",
      cap: 1.0,
      kind: "bins",
      bins: [
        [0, 1, 0],
        [1, 2, 0.3],
        [2, 3, 1.0],
      ],
    },
    "x.newAndBlue": { group: "verification", cap: 0.8, kind: "bool", weight: 0.8 },
    "x.replyShare": {
      group: "content",
      cap: 0.8,
      kind: "bins",
      bins: [
        [0, 0.9, 0],
        [0.9, null, 0.8],
      ],
    },
    "x.usernameChanges": {
      group: "profile",
      cap: 0.6,
      kind: "bins",
      bins: [
        [0, 3, 0],
        [3, null, 0.6],
      ],
    },
    "x.countryLocaleMismatch": { group: "geo", cap: 0.4, kind: "bool", weight: 0.4 },
  },
};

export const DAY_MS = 24 * 60 * 60 * 1000;

/** A fixed "now" so relative dates in reasons are deterministic. */
export const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

export const ALL_TIERS: SourceTier[] = [0, 1, 2];

export function feature(
  id: string,
  value: number | boolean,
  group: Feature["group"],
  tier: SourceTier = 0,
): Feature {
  return { id, value, group, tier };
}

interface SignalsOptions {
  handle?: string;
  tiersDelivered?: SourceTier[];
  values?: Partial<Pick<AccountSignals, SignalField>>;
}

/** Signals with every requested tier marked as delivering one field, plus any explicit values. */
export function signalsWith(options: SignalsOptions = {}): AccountSignals {
  const tiers: SourceTier[] = options.tiersDelivered ?? [0];
  const provenance: AccountSignals["provenance"] = {};
  const fieldsByTier: Record<SourceTier, SignalField> = {
    0: "displayName",
    1: "createdAt",
    2: "country",
  };
  for (const tier of tiers) {
    provenance[fieldsByTier[tier]] = tier;
  }
  return {
    ref: { platform: "x", handle: options.handle ?? "someone" },
    ...options.values,
    provenance,
    tiersDelivered: [...tiers].sort(),
    observedAt: NOW,
  };
}
