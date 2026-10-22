import { scoreAccount } from "@/src/core/scoring/engine";
import type { PlatformWeights } from "@/src/core/scoring/types";
import type { Feature, Verdict } from "@/src/core/types";
import { ALL_TIERS, DAY_MS, NOW, feature, signalsWith, testWeights } from "./testWeights";

const options = { policyVersion: 7, now: NOW, sourcesAvailable: ALL_TIERS };

const strongActivity: Feature = feature("x.postsPerDay", 200, "activity");
const strongAge: Feature = feature("x.accountAgeDays", 10, "age", 1);
const strongLikes: Feature = feature("x.likesPerDay", 500, "activity");
const newAndBlue: Feature = feature("x.newAndBlue", true, "verification", 1);

function score(features: Feature[], tiersDelivered = ALL_TIERS): Verdict {
  return scoreAccount(features, signalsWith({ tiersDelivered }), testWeights, options);
}

describe("scoreAccount short-circuits", () => {
  it("returns declared with confidence 1 and no scoring when the platform labels the account", () => {
    const verdict: Verdict = scoreAccount(
      [strongActivity, strongAge],
      signalsWith({ tiersDelivered: [0], values: { declaredAutomated: true } }),
      testWeights,
      options,
    );
    expect(verdict.tier).toBe("declared");
    expect(verdict.confidence).toBe(1);
    expect(verdict.lowConfidence).toBe(false);
    expect(verdict.evidence).toEqual([]);
    expect(verdict.reasons).toEqual(["Carries the platform's own automated-account label"]);
    expect(verdict.logOdds).toBe(testWeights.prior);
  });

  it("returns unknown with confidence 0 when there are no features", () => {
    const verdict: Verdict = score([]);
    expect(verdict.tier).toBe("unknown");
    expect(verdict.confidence).toBe(0);
    expect(verdict.evidence).toEqual([]);
    expect(verdict.reasons).toEqual([]);
  });
});

describe("scoreAccount golden table", () => {
  it("typical: an old, quiet account with negative evidence", () => {
    const verdict: Verdict = score([
      feature("x.postsPerDay", 3, "activity"),
      feature("x.accountAgeDays", 2000, "age"),
      feature("x.followingRatio", 0.5, "graph"),
    ]);
    expect(verdict.tier).toBe("typical");
    expect(verdict.logOdds).toBeCloseTo(-3.3, 10);
    expect(verdict.probability).toBeCloseTo(0.0356, 3);
    expect(verdict.evidence.map((item) => item.contribution)).toEqual([-0.5, -0.3, 0]);
  });

  it("some: one strong feature clears the some threshold but not the independence rule", () => {
    const verdict: Verdict = score([strongActivity]);
    expect(verdict.logOdds).toBeCloseTo(-0.5, 10);
    expect(verdict.probability).toBeCloseTo(0.3775, 3);
    expect(verdict.tier).toBe("some");
  });

  it("many: two strong features from distinct groups with full confidence", () => {
    const verdict: Verdict = score([strongActivity, strongAge]);
    expect(verdict.logOdds).toBeCloseTo(1.0, 10);
    expect(verdict.probability).toBeCloseTo(0.7311, 3);
    expect(verdict.confidence).toBe(1);
    expect(verdict.tier).toBe("many");
    expect(verdict.lowConfidence).toBe(false);
  });

  it("some: two strong features from the SAME group never reach many", () => {
    const verdict: Verdict = score([strongActivity, strongLikes]);
    expect(verdict.probability).toBeGreaterThan(testWeights.thresholds.many);
    expect(verdict.tier).toBe("some");
  });

  it("some: two strong groups whose probability stays under the many threshold", () => {
    const verdict: Verdict = score([strongActivity, newAndBlue]);
    expect(verdict.logOdds).toBeCloseTo(0.3, 10);
    expect(verdict.probability).toBeLessThan(testWeights.thresholds.many);
    expect(verdict.tier).toBe("some");
  });

  it("typical: three handle features are capped as a group before the logistic", () => {
    const verdict: Verdict = score([
      feature("x.handleNameDigits", true, "handle"),
      feature("x.handleTrailingDigits", 6, "handle"),
      feature("x.handleBigramLL", -5, "handle"),
    ]);
    expect(verdict.evidence.map((item) => item.contribution)).toEqual([
      expect.closeTo(0.48, 10),
      expect.closeTo(0.42, 10),
      expect.closeTo(0.3, 10),
    ]);
    expect(verdict.logOdds).toBeCloseTo(-1.3, 10);
    expect(verdict.tier).toBe("typical");
  });

  it("a feature the weights table does not know contributes nothing", () => {
    const verdict: Verdict = score([feature("x.unknownSignal", 99, "content"), strongActivity]);
    expect(verdict.evidence).toHaveLength(1);
    expect(verdict.logOdds).toBeCloseTo(-0.5, 10);
  });
});

describe("scoreAccount confidence", () => {
  it("is the weighted share of tiers that delivered at least one field", () => {
    expect(score([strongActivity], [0]).confidence).toBeCloseTo(0.25, 10);
    expect(score([strongActivity], [0, 2]).confidence).toBeCloseTo(0.45, 10);
    expect(score([strongActivity], [0, 1]).confidence).toBeCloseTo(0.8, 10);
  });

  it("low confidence caps a many-worthy account at some and flags it", () => {
    const verdict: Verdict = score([strongActivity, strongAge], [0]);
    expect(verdict.confidence).toBeCloseTo(0.25, 10);
    expect(verdict.lowConfidence).toBe(true);
    expect(verdict.tier).toBe("some");
    expect(verdict.sourcesUsed).toEqual([0]);
    expect(verdict.sourcesMissing).toEqual([1, 2]);
  });

  it("confidence between 0.4 and 0.5 blocks many without the low-confidence flag", () => {
    const verdict: Verdict = score([strongActivity, strongAge], [0, 2]);
    expect(verdict.lowConfidence).toBe(false);
    expect(verdict.tier).toBe("some");
  });

  it("confidence of 0.8 from tiers 0 and 1 allows many", () => {
    expect(score([strongActivity, strongAge], [0, 1]).tier).toBe("many");
  });

  it("a tier with zero weight is neither counted nor reported missing", () => {
    const redditLike: PlatformWeights = {
      ...testWeights,
      confidenceWeights: { 0: 0.3, 1: 0, 2: 0.7 },
    };
    const verdict: Verdict = scoreAccount(
      [strongActivity],
      signalsWith({ tiersDelivered: [0, 2] }),
      redditLike,
      options,
    );
    expect(verdict.confidence).toBeCloseTo(1, 10);
    expect(verdict.sourcesMissing).toEqual([]);
  });
});

describe("scoreAccount verdict shape", () => {
  it("sorts evidence by absolute contribution, descending", () => {
    const verdict: Verdict = score([
      feature("x.followingRatio", 0.5, "graph"),
      feature("x.accountAgeDays", 2000, "age"),
      strongActivity,
      feature("x.handleTrailingDigits", 2, "handle"),
    ]);
    expect(verdict.evidence.map((item) => item.feature)).toEqual([
      "x.postsPerDay",
      "x.accountAgeDays",
      "x.followingRatio",
      "x.handleTrailingDigits",
    ]);
  });

  it("carries the evidence group and tier through", () => {
    const verdict: Verdict = score([strongAge]);
    expect(verdict.evidence[0]).toMatchObject({ group: "age", tier: 1 });
  });

  it("stamps the policy version and the supplied clock", () => {
    const verdict: Verdict = score([strongActivity]);
    expect(verdict.policyVersion).toBe(7);
    expect(verdict.computedAt).toBe(NOW);
  });

  it("defaults the clock to now", () => {
    const before: number = Date.now();
    const verdict: Verdict = scoreAccount([strongActivity], signalsWith(), testWeights, {
      policyVersion: 1,
      sourcesAvailable: ALL_TIERS,
    });
    expect(verdict.computedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("scoreAccount wording", () => {
  it("renders reasons through the templates using the post-cap contribution sign", () => {
    const verdict: Verdict = scoreAccount(
      [strongActivity, feature("x.accountAgeDays", 2190, "age", 1)],
      signalsWith({ tiersDelivered: ALL_TIERS, values: { createdAt: NOW - 2190 * DAY_MS } }),
      testWeights,
      options,
    );
    expect(verdict.reasons).toEqual(["~200 posts/day since joining", "Account is 6 years old"]);
    expect(verdict.evidence[0]?.reason).toBe("~200 posts/day since joining");
  });

  it("keys the caveat on the dominant group and the account age", () => {
    const recent: Verdict = score([strongActivity, strongAge]);
    expect(recent.caveat).toBe(
      "High-volume human posters, news desks and brand accounts show the same pattern. This is a pattern read, not a verdict. Humans trip these signals every day.",
    );
  });

  it("attaches a confidence note under 0.7 and omits it above", () => {
    const partial: Verdict = score([strongActivity], [0, 2]);
    expect(partial.confidence).toBeCloseTo(0.45, 10);
    expect(partial.confidenceNote).toBe("Profile details not loaded yet");
    expect(partial.caveat).toMatch(/Some signals could not be loaded/);

    const full: Verdict = score([strongActivity], [0, 1]);
    expect(full.confidence).toBeCloseTo(0.8, 10);
    expect(full.confidenceNote).toBeUndefined();
    expect(full.sourcesMissing).toEqual([2]);
  });

  it("says a tier is off when the config does not allow it", () => {
    const verdict: Verdict = scoreAccount(
      [strongActivity],
      signalsWith({ tiersDelivered: [0] }),
      testWeights,
      { ...options, sourcesAvailable: [0] },
    );
    expect(verdict.confidenceNote).toBe("Profile details are off; Extra lookups are off");
  });

  it("gives declared accounts the declared caveat and no confidence note", () => {
    const verdict: Verdict = scoreAccount(
      [],
      signalsWith({ tiersDelivered: [0], values: { declaredAutomated: true } }),
      testWeights,
      options,
    );
    expect(verdict.caveat).toMatch(/^The account operator chose to label it as automated/);
    expect(verdict.confidenceNote).toBeUndefined();
  });
});
