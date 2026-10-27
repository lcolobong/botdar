import { scoreAccount } from "@/src/core/scoring/engine";
import type { PlatformWeights } from "@/src/core/scoring/types";
import { defaultWeights } from "@/src/core/scoring/weights";
import type { AccountSignals, Feature, Verdict } from "@/src/core/types";
import { reasonTexts } from "../../../fakeReasons";
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
    expect(verdict.reasons).toEqual([
      {
        text: "Carries the platform's own automated-account label",
        why: "self-declared",
        direction: "automated",
        tier: 0,
      },
    ]);
    expect(verdict.logOdds).toBe(testWeights.prior);
  });

  it("gives the declared reason the tier that saw the declaration", () => {
    const signals: AccountSignals = signalsWith({
      tiersDelivered: [0, 1],
      values: { declaredAutomated: true },
    });
    const fromPageData: Verdict = scoreAccount(
      [],
      { ...signals, provenance: { ...signals.provenance, declaredAutomated: 1 } },
      testWeights,
      options,
    );
    expect(fromPageData.reasons[0]?.tier).toBe(1);
    const unattributed: Verdict = scoreAccount([], signals, testWeights, options);
    expect(unattributed.reasons[0]?.tier).toBe(1);
  });

  it("returns unknown with confidence 0 when there are no features", () => {
    const verdict: Verdict = score([]);
    expect(verdict.tier).toBe("unknown");
    expect(verdict.confidence).toBe(0);
    expect(verdict.evidence).toEqual([]);
    expect(verdict.reasons).toEqual([]);
  });
});

describe("scoreAccount earning Likely human", () => {
  const ordinary: Feature[] = [
    feature("x.postsPerDay", 3, "activity", 1),
    feature("x.accountAgeDays", 2000, "age", 1),
  ];

  it("returns unknown when the handle is all the evidence and it reads typical", () => {
    const verdict: Verdict = score([
      feature("x.handleNameDigits", false, "handle"),
      feature("x.handleTrailingDigits", 0, "handle"),
    ]);
    expect(verdict.tier).toBe("unknown");
    expect(verdict.reasons).toEqual([]);
    expect(verdict.confidence).toBe(0);
    expect(verdict.lowConfidence).toBe(true);
    expect(verdict.caveat).toBe("Too little is visible about this account to read it either way.");
  });

  it("returns unknown when no feature is known to the weights table", () => {
    expect(score([feature("x.somethingNew", 3, "activity")]).tier).toBe("unknown");
  });

  it("is typical with two items beyond the handle at confidence 0.5 or more", () => {
    const verdict: Verdict = score([feature("x.handleNameDigits", false, "handle"), ...ordinary]);
    expect(verdict.tier).toBe("typical");
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it("returns unknown with one item beyond the handle", () => {
    const verdict: Verdict = score([
      feature("x.handleNameDigits", false, "handle"),
      feature("x.accountAgeDays", 2000, "age", 1),
    ]);
    expect(verdict.tier).toBe("unknown");
  });

  it("does not count an item whose pattern is absent and has nothing to say", () => {
    const verdict: Verdict = score([
      feature("x.accountAgeDays", 2000, "age", 1),
      feature("x.newAndBlue", false, "verification", 1),
    ]);
    expect(verdict.tier).toBe("unknown");
  });

  it("gives a Likely human card at least two reasons", () => {
    const verdict: Verdict = score(ordinary);
    expect(verdict.tier).toBe("typical");
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("does not let observations that point towards automation earn Likely human", () => {
    const youngDefault: Verdict = scoreAccount(
      [
        feature("reddit.accountAgeDays", 42, "age", 2),
        feature("reddit.noAvatar", true, "profile"),
        feature("reddit.noVerifiedEmail", true, "profile", 2),
      ],
      signalsWith({ tiersDelivered: [0, 2] }),
      defaultWeights.reddit,
      { ...options, sourcesAvailable: [0, 2] },
    );
    expect(youngDefault.probability).toBeLessThan(0.3);
    expect(youngDefault.tier).toBe("unknown");
  });

  it("lets neutral ordinary observations earn Likely human on Reddit", () => {
    const longStanding: Verdict = scoreAccount(
      [
        feature("reddit.accountAgeDays", 2600, "age", 2),
        feature("reddit.noAvatar", false, "profile"),
        feature("reddit.noVerifiedEmail", false, "profile", 2),
      ],
      signalsWith({ tiersDelivered: [0, 2] }),
      defaultWeights.reddit,
      { ...options, sourcesAvailable: [0, 2] },
    );
    expect(longStanding.tier).toBe("typical");
    expect(reasonTexts(longStanding)).toEqual(["Account is 7 years old", "Custom avatar"]);
    expect(longStanding.reasons.map((reason) => reason.direction)).toEqual([
      "ordinary",
      "ordinary",
    ]);
  });

  it("does not let zero-weight evidence that points towards automated vouch for an account", () => {
    const signals: AccountSignals = signalsWith({
      tiersDelivered: [0, 1],
      values: { createdAt: NOW - 2555 * DAY_MS, country: "Brazil" },
    });
    const withMismatch: Verdict = scoreAccount(
      [
        feature("x.accountAgeDays", 2555, "age", 1),
        feature("x.countryLocaleMismatch", true, "geo", 1),
      ],
      signals,
      defaultWeights.x,
      options,
    );
    expect(withMismatch.tier).toBe("unknown");

    const withProfile: Verdict = scoreAccount(
      [
        feature("x.accountAgeDays", 2555, "age", 1),
        feature("x.defaultAvatarEmptyBio", 0, "profile", 1),
      ],
      signals,
      defaultWeights.x,
      options,
    );
    expect(withProfile.tier).toBe("typical");
    expect(withProfile.reasons.map((reason) => reason.direction)).toEqual(["ordinary", "ordinary"]);
  });

  it("returns unknown below confidence 0.5, as on Reddit before a lookup delivers", () => {
    const tier0Only: Verdict = scoreAccount(
      [
        feature("reddit.generatedName", false, "handle"),
        feature("reddit.noAvatar", false, "profile"),
        feature("reddit.noVerifiedEmail", false, "profile"),
      ],
      signalsWith({ tiersDelivered: [0] }),
      defaultWeights.reddit,
      { ...options, sourcesAvailable: [0, 2] },
    );
    expect(tier0Only.tier).toBe("unknown");
    expect(score(ordinary, [0]).tier).toBe("unknown");
    expect(score(ordinary, [0, 1]).tier).toBe("typical");
  });

  it("leaves Unsure and Likely bot untouched at low confidence", () => {
    expect(score([feature("x.postsPerDay", 200, "activity")], [0]).tier).toBe("some");
  });

  it("keeps a handle-only read that a policy prior lifts above typical", () => {
    const verdict: Verdict = scoreAccount(
      [feature("x.handleNameDigits", true, "handle"), feature("x.handleBigramLL", -5, "handle")],
      signalsWith({ tiersDelivered: ALL_TIERS }),
      { ...testWeights, prior: -0.5 },
      options,
    );
    expect(verdict.tier).toBe("some");
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

  it("the two timing features share a cap of 1.5 and never reach many on their own", () => {
    const timing: Feature[] = [
      feature("x.gapRegularity", 0.05, "timing", 1),
      feature("x.noSleepWindow", 0, "timing", 1),
    ];
    const verdict: Verdict = scoreAccount(timing, signalsWith(), defaultWeights.x, options);
    expect(verdict.tier).not.toBe("many");
    const withStrongAge: Verdict = scoreAccount(
      [...timing, feature("x.accountAgeDays", 10, "age", 1)],
      signalsWith({ tiersDelivered: ALL_TIERS }),
      defaultWeights.x,
      options,
    );
    // 1.0 + 1.0 scaled down to the group cap; a second group is what reaches many.
    expect(withStrongAge.evidence.map((item) => item.contribution)).toEqual([1.5, 0.75, 0.75]);
    expect(withStrongAge.logOdds).toBeCloseTo(defaultWeights.x.prior + 3, 10);
    expect(withStrongAge.tier).toBe("many");
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
    // Two neutral items beyond the handle keep this a Likely human read rather than unknown.
    const verdict: Verdict = score([
      feature("x.handleNameDigits", true, "handle"),
      feature("x.handleTrailingDigits", 6, "handle"),
      feature("x.handleBigramLL", -5, "handle"),
      feature("x.postsPerDay", 3, "activity"),
      feature("x.followingRatio", 2, "graph"),
    ]);
    expect(verdict.evidence.map((item) => item.contribution)).toEqual([
      expect.closeTo(0.48, 10),
      expect.closeTo(0.42, 10),
      expect.closeTo(0.3, 10),
      0,
      0,
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

  it("counts a tier that delivered even when a higher tier now owns every field", () => {
    const signals: AccountSignals = signalsWith({ tiersDelivered: [0, 1, 2] });
    const overwritten: AccountSignals = {
      ...signals,
      provenance: { displayName: 2, createdAt: 2, country: 2 },
    };
    const verdict: Verdict = scoreAccount([strongActivity], overwritten, testWeights, options);
    expect(verdict.sourcesUsed).toEqual([0, 1, 2]);
    expect(verdict.sourcesMissing).toEqual([]);
    expect(verdict.confidence).toBeCloseTo(1, 10);
    expect(verdict.caveat).not.toMatch(/could not be loaded/);
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
    const verdict: Verdict = score([strongAge, strongActivity]);
    expect(verdict.evidence.find((item) => item.group === "age")).toMatchObject({ tier: 1 });
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
      [
        strongActivity,
        feature("x.accountAgeDays", 2190, "age", 1),
        feature("x.followingRatio", 0.5, "graph", 1),
      ],
      signalsWith({ tiersDelivered: ALL_TIERS, values: { createdAt: NOW - 2190 * DAY_MS } }),
      testWeights,
      options,
    );
    expect(verdict.reasons.slice(0, 2)).toEqual([
      {
        text: "~200 posts/day since joining",
        why: "prolonged hyperactivity",
        direction: "automated",
        contribution: 2,
        tier: 0,
      },
      {
        text: "Account is 6 years old",
        why: "outlasted platform enforcement",
        direction: "ordinary",
        contribution: -0.5,
        tier: 1,
      },
    ]);
    expect(verdict.evidence[0]?.reason).toBe("~200 posts/day since joining");
  });

  it("lists an observation two features word the same way only once", () => {
    const verdict: Verdict = scoreAccount(
      [
        strongActivity,
        feature("x.handleNameDigits", true, "handle"),
        feature("x.handleTrailingDigits", 5, "handle"),
      ],
      signalsWith({ handle: "john12345", tiersDelivered: ALL_TIERS }),
      testWeights,
      options,
    );
    expect(reasonTexts(verdict)).toEqual([
      "~200 posts/day since joining",
      "Handle is a name followed by 5 digits",
    ]);
  });

  it("keys the caveat on the dominant group and the account age", () => {
    const recent: Verdict = score([strongActivity, strongAge]);
    expect(recent.caveat).toBe(
      "High-volume human posters, news desks and brand accounts show the same pattern.",
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
    expect(verdict.confidenceNote).toBe("Profile details are off. Extra lookups are off");
  });

  it("words a Likely human card with what looks ordinary and its counter-case", () => {
    const verdict: Verdict = scoreAccount(
      [
        feature("reddit.accountAgeDays", 3300, "age", 2),
        feature("reddit.generatedName", false, "handle"),
        feature("reddit.noAvatar", false, "profile", 2),
        feature("reddit.noVerifiedEmail", false, "profile", 2),
      ],
      signalsWith({ tiersDelivered: [0, 2], values: { createdAt: NOW - 3300 * DAY_MS } }),
      defaultWeights.reddit,
      { ...options, sourcesAvailable: [0, 2] },
    );
    expect(verdict.tier).toBe("typical");
    expect(reasonTexts(verdict)).toEqual(["Account is 9 years old", "Custom avatar"]);
    expect(verdict.caveat).toBe("An aged account can be bought and repurposed.");
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
