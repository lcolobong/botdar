import { buildDefaults, platformIds } from "../../../src/core/policy/defaults.ts";
import type { BuildDefaults } from "../../../src/core/policy/defaults.ts";
import { applyPolicy } from "../../../src/core/policy/merge.ts";
import type { EffectiveConfig, PlatformWeights } from "../../../src/core/policy/merge.ts";
import type { Policy, PolicyPlatform } from "../../../src/core/policy/schema.ts";
import type { PlatformId } from "../../../src/core/types.ts";

interface ScoringFeature {
  group: string;
  kind: "bins" | "bool";
  cap: number;
  bins?: [number | null, number | null, number][];
  weight?: number;
}

interface ScoringWeights extends PlatformWeights {
  groupCaps: Record<string, number>;
  features: Record<string, ScoringFeature>;
}

function weights(): Record<PlatformId, ScoringWeights> {
  const platform = (): ScoringWeights => ({
    prior: -2.5,
    thresholds: { some: 0.3, many: 0.6 },
    groupCaps: { handle: 1.2 },
    features: {
      postsPerDay: {
        group: "activity",
        kind: "bins",
        cap: 2,
        bins: [
          [0, 10, 0],
          [10, 30, 0.4],
          [30, null, 2],
        ],
      },
      handleDigits: { group: "handle", kind: "bool", cap: 0.7, weight: 0.7 },
    },
  });
  return { x: platform(), reddit: platform(), bluesky: platform() };
}

function policyWith(platforms: Record<string, PolicyPlatform>, version = 2): Policy {
  return {
    schema: 1,
    version,
    issuedAt: "2026-10-22T00:00:00Z",
    minExtensionVersion: "0.1.0",
    platforms,
  };
}

function restrictedDefaults(): BuildDefaults {
  return {
    x: { enabled: false, tiers: { t1: false, t2: false }, rateLimitPerMinute: 5 },
    reddit: { enabled: false, tiers: { t1: false, t2: false }, rateLimitPerMinute: 5 },
    bluesky: { enabled: false, tiers: { t1: false, t2: false }, rateLimitPerMinute: 5 },
  };
}

describe("applyPolicy", () => {
  describe("without a policy", () => {
    it("returns the build defaults and weights unchanged, version 0", () => {
      const effective: EffectiveConfig<ScoringWeights> = applyPolicy(
        buildDefaults,
        weights(),
        null,
      );
      expect(effective.policyVersion).toBe(0);
      expect(effective.notice).toBeUndefined();
      for (const platform of platformIds) {
        expect(effective.platforms[platform]).toEqual({
          platform,
          enabled: true,
          tiers: { t1: true, t2: true },
          rateLimitPerMinute: buildDefaults[platform].rateLimitPerMinute,
          policyVersion: 0,
        });
        expect(effective.weights[platform]).toEqual(weights()[platform]);
      }
    });

    it("is deeply frozen and does not freeze the inputs", () => {
      const input: Record<PlatformId, ScoringWeights> = weights();
      const effective: EffectiveConfig<ScoringWeights> = applyPolicy(buildDefaults, input, null);
      expect(Object.isFrozen(effective)).toBe(true);
      expect(Object.isFrozen(effective.platforms.x.tiers)).toBe(true);
      expect(Object.isFrozen(effective.weights.x.features.postsPerDay?.bins)).toBe(true);
      expect(Object.isFrozen(input.x.features.postsPerDay)).toBe(false);
    });
  });

  describe("cannot enable", () => {
    const permissivePolicy = (): Policy =>
      policyWith({
        x: {
          enabled: true,
          tiers: { t1: true, t2: true },
          rateLimitPerMinute: 600,
          prior: 0,
          features: { postsPerDay: { cap: 9, bins: [[0, null, 9]] }, handleDigits: { weight: 9 } },
        },
        reddit: { enabled: true, tiers: { t1: true, t2: true } },
        bluesky: { enabled: true, tiers: { t1: true, t2: true } },
      });

    it.each(platformIds)("keeps %s disabled when the build has it disabled", (platform) => {
      const effective: EffectiveConfig = applyPolicy(
        restrictedDefaults(),
        weights(),
        permissivePolicy(),
      );
      expect(effective.platforms[platform].enabled).toBe(false);
    });

    it.each([
      ["t1", platformIds],
      ["t2", platformIds],
    ] as const)("keeps tier %s off when the build has it off", (tier, platforms) => {
      const effective: EffectiveConfig = applyPolicy(
        restrictedDefaults(),
        weights(),
        permissivePolicy(),
      );
      for (const platform of platforms) {
        expect(effective.platforms[platform].tiers[tier]).toBe(false);
      }
    });

    it("never raises the rate limit above the build default", () => {
      const effective: EffectiveConfig = applyPolicy(
        restrictedDefaults(),
        weights(),
        permissivePolicy(),
      );
      expect(effective.platforms.x.rateLimitPerMinute).toBe(5);
    });

    it("never raises a feature cap above the build default", () => {
      const effective: EffectiveConfig = applyPolicy(buildDefaults, weights(), permissivePolicy());
      expect(effective.weights.x.features.postsPerDay?.cap).toBe(2);
    });

    it("clamps replaced bins and weights to the effective cap", () => {
      const effective: EffectiveConfig = applyPolicy(buildDefaults, weights(), permissivePolicy());
      expect(effective.weights.x.features.postsPerDay?.bins).toEqual([[0, null, 2]]);
      expect(effective.weights.x.features.handleDigits?.weight).toBe(0.7);
    });

    it("never moves the prior toward many", () => {
      const effective: EffectiveConfig = applyPolicy(buildDefaults, weights(), permissivePolicy());
      expect(effective.weights.x.prior).toBe(-2.5);
    });

    it("ignores a platform the build does not know", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ mastodon: { enabled: true, tiers: { t1: true, t2: true } } }),
      );
      expect(Object.keys(effective.platforms)).toEqual([...platformIds]);
      expect(Object.keys(effective.weights)).toEqual([...platformIds]);
    });

    it("ignores a feature the build does not know", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, features: { invented: { cap: 3, weight: 3 } } } }),
      );
      expect(Object.keys(effective.weights.x.features)).toEqual(["postsPerDay", "handleDigits"]);
    });

    it("cannot change a feature's kind: bins on a bool feature and weight on a bins feature are dropped", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({
          x: {
            enabled: true,
            features: { handleDigits: { bins: [[0, null, 0.5]] }, postsPerDay: { weight: 1 } },
          },
        }),
      );
      expect(effective.weights.x.features.handleDigits?.bins).toBeUndefined();
      expect(effective.weights.x.features.postsPerDay?.weight).toBeUndefined();
    });

    it("rejects an aboutAccountQueryId that does not match the allowed shape", () => {
      const tooShort: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, x: { aboutAccountQueryId: "short" } } }),
      );
      const badChars: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, x: { aboutAccountQueryId: "abc.def/ghi;jkl mno" } } }),
      );
      expect(tooShort.platforms.x.aboutAccountQueryId).toBeUndefined();
      expect(badChars.platforms.x.aboutAccountQueryId).toBeUndefined();
    });

    it("only accepts an aboutAccountQueryId for X", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ reddit: { enabled: true, x: { aboutAccountQueryId: "abcdefghijklmnop" } } }),
      );
      expect(effective.platforms.reddit.aboutAccountQueryId).toBeUndefined();
    });
  });

  describe("can restrict", () => {
    it("disables a platform", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: false } }),
      );
      expect(effective.platforms.x.enabled).toBe(false);
      expect(effective.platforms.reddit.enabled).toBe(true);
    });

    it("switches a single tier off and leaves the other untouched", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ reddit: { enabled: true, tiers: { t2: false } } }),
      );
      expect(effective.platforms.reddit.tiers).toEqual({ t1: true, t2: false });
    });

    it("lowers the rate limit", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, rateLimitPerMinute: 4 } }),
      );
      expect(effective.platforms.x.rateLimitPerMinute).toBe(4);
    });

    it("lowers a cap and clamps the build bins to it", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, features: { postsPerDay: { cap: 1 } } } }),
      );
      expect(effective.weights.x.features.postsPerDay?.cap).toBe(1);
      expect(effective.weights.x.features.postsPerDay?.bins).toEqual([
        [0, 10, 0],
        [10, 30, 0.4],
        [30, null, 1],
      ]);
    });

    it("replaces bins wholesale", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({
          x: {
            enabled: true,
            features: {
              postsPerDay: {
                bins: [
                  [0, 100, 0],
                  [100, null, 1.5],
                ],
              },
            },
          },
        }),
      );
      expect(effective.weights.x.features.postsPerDay?.bins).toEqual([
        [0, 100, 0],
        [100, null, 1.5],
      ]);
    });

    it("moves the prior toward typical and clamps it at -5", () => {
      const lowered: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, prior: -3.5 } }),
      );
      const floored: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, prior: -9 } }),
      );
      expect(lowered.weights.x.prior).toBe(-3.5);
      expect(floored.weights.x.prior).toBe(-5);
    });

    it("replaces thresholds, clamps them to [0.15, 0.95] and keeps many at least 0.1 above some", () => {
      const raised: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, thresholds: { many: 0.8 } } }),
      );
      const clamped: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, thresholds: { some: 0.01, many: 0.99 } } }),
      );
      const squeezed: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, thresholds: { some: 0.9, many: 0.5 } } }),
      );
      expect(raised.weights.x.thresholds).toEqual({ some: 0.3, many: 0.8 });
      expect(clamped.weights.x.thresholds).toEqual({ some: 0.15, many: 0.95 });
      expect(squeezed.weights.x.thresholds.some).toBeCloseTo(0.85);
      expect(squeezed.weights.x.thresholds.many).toBeCloseTo(0.95);
    });

    it("accepts a well-formed aboutAccountQueryId for X", () => {
      const effective: EffectiveConfig = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, x: { aboutAccountQueryId: "Ab_12-cdefghijklmnop" } } }),
      );
      expect(effective.platforms.x.aboutAccountQueryId).toBe("Ab_12-cdefghijklmnop");
    });

    it("carries the policy version and notice through", () => {
      const policy: Policy = {
        ...policyWith({}, 7),
        notice: { id: "2026-10-a", text: "X lookups paused" },
      };
      const effective: EffectiveConfig = applyPolicy(buildDefaults, weights(), policy);
      expect(effective.policyVersion).toBe(7);
      expect(effective.platforms.bluesky.policyVersion).toBe(7);
      expect(effective.notice).toEqual({ id: "2026-10-a", text: "X lookups paused" });
    });

    it("passes scoring fields the policy cannot touch through unchanged", () => {
      const effective: EffectiveConfig<ScoringWeights> = applyPolicy(
        buildDefaults,
        weights(),
        policyWith({ x: { enabled: true, features: { postsPerDay: { cap: 1 } } } }),
      );
      expect(effective.weights.x.groupCaps).toEqual({ handle: 1.2 });
      expect(effective.weights.x.features.postsPerDay?.group).toBe("activity");
      expect(effective.weights.x.features.postsPerDay?.kind).toBe("bins");
    });
  });
});
