import { scoreAccount } from "@/src/core/scoring/engine";
import { templatedFeatureIds } from "@/src/core/scoring/reasons";
import { reasonTexts } from "../../../fakeReasons";
import type { FeatureSpec, PlatformWeights } from "@/src/core/scoring/types";
import { WeightsFileError, defaultWeights, parseWeightsFile } from "@/src/core/scoring/weights";
import type { PlatformId, Verdict } from "@/src/core/types";
import malformedWeights from "../../../fixtures/scoring/weights.malformed.json";
import { ALL_TIERS, NOW, feature, signalsWith } from "./testWeights";

const PLATFORMS: PlatformId[] = ["x", "reddit", "bluesky", "hackernews"];

function validFile(): Record<string, unknown> {
  return structuredClone({ schema: 1, platforms: defaultWeights });
}

function withPatch(patch: (file: Record<string, unknown>) => void): Record<string, unknown> {
  const file: Record<string, unknown> = validFile();
  patch(file);
  return file;
}

function platformOf(file: Record<string, unknown>, id: PlatformId): Record<string, unknown> {
  const platforms = file.platforms as Record<PlatformId, Record<string, unknown>>;
  return platforms[id];
}

describe("defaultWeights", () => {
  it("loads a table for every platform with the spec's prior and confidence weights", () => {
    expect(Object.keys(defaultWeights).sort()).toEqual([...PLATFORMS].sort());
    expect(defaultWeights.x.prior).toBe(-2.5);
    expect(defaultWeights.reddit.prior).toBe(-2.8);
    expect(defaultWeights.bluesky.prior).toBe(-2.5);
    expect(defaultWeights.x.confidenceWeights).toEqual({ 0: 0.25, 1: 0.55, 2: 0.2 });
    expect(defaultWeights.reddit.confidenceWeights).toEqual({ 0: 0.3, 1: 0, 2: 0.7 });
    expect(defaultWeights.bluesky.confidenceWeights).toEqual({ 0: 0.2, 1: 0.4, 2: 0.4 });
    // Hacker News mirrors Reddit: no Tier 1, and the lookup carries most of the confidence.
    expect(defaultWeights.hackernews.prior).toBe(-2.8);
    expect(defaultWeights.hackernews.confidenceWeights).toEqual({ 0: 0.3, 1: 0, 2: 0.7 });
  });

  it("caps handle, profile and timing on X and Bluesky, geo on X, and coordination everywhere", () => {
    expect(defaultWeights.x.groupCaps).toEqual({
      handle: 1.2,
      profile: 1.2,
      geo: 0.4,
      timing: 1.5,
      coordination: 1.5,
    });
    expect(defaultWeights.bluesky.groupCaps).toEqual({
      handle: 1.2,
      profile: 1.2,
      timing: 1.5,
      coordination: 1.5,
    });
    expect(defaultWeights.reddit.groupCaps).toEqual({ coordination: 1.5 });
    expect(defaultWeights.hackernews.groupCaps).toEqual({ coordination: 1.5 });
  });

  it("weighs near-duplicate replies the same on every platform, capped at 1.5", () => {
    for (const platform of PLATFORMS) {
      expect(defaultWeights[platform].features["thread.nearDuplicateReply"]).toEqual({
        group: "coordination",
        cap: 1.5,
        kind: "bins",
        bins: [
          [0, 1, 0],
          [1, 2, 0.6],
          [2, 4, 1.0],
          [4, null, 1.5],
        ],
      });
    }
  });

  it("keeps a thread of copied replies alone below Unsure", () => {
    for (const platform of PLATFORMS) {
      const verdict: Verdict = scoreAccount(
        [feature("thread.nearDuplicateReply", 12, "coordination", 0)],
        signalsWith({ tiersDelivered: ALL_TIERS }),
        defaultWeights[platform],
        { policyVersion: 0, now: NOW, sourcesAvailable: ALL_TIERS },
      );
      expect(verdict.probability, platform).toBeLessThan(defaultWeights[platform].thresholds.some);
    }
  });

  it("weighs the two timing features as spec'd and caps them together below both", () => {
    for (const prefix of ["x", "bsky"] as const) {
      const platform: PlatformWeights = prefix === "x" ? defaultWeights.x : defaultWeights.bluesky;
      expect(platform.features[`${prefix}.gapRegularity`]).toEqual({
        group: "timing",
        cap: 1.0,
        kind: "bins",
        bins: [
          [0, 0.5, 1.0],
          [0.5, 0.8, 0.5],
          [0.8, null, 0],
        ],
      });
      expect(platform.features[`${prefix}.noSleepWindow`]).toEqual({
        group: "timing",
        cap: 1.0,
        kind: "bins",
        bins: [
          [0, 2, 1.0],
          [2, 4, 0.5],
          [4, null, 0],
        ],
      });
    }
  });

  it("has the feature set from the spec for each platform", () => {
    expect(Object.keys(defaultWeights.x.features)).toEqual([
      "x.postsPerDay",
      "x.accountAgeDays",
      "x.followingRatio",
      "x.handleNameDigits",
      "x.handleTrailingDigits",
      "x.handleBigramLL",
      "x.defaultAvatarEmptyBio",
      "x.newAndBlue",
      "x.replyShare",
      "x.usernameChanges",
      "x.countryLocaleMismatch",
      "x.gapRegularity",
      "x.noSleepWindow",
      "thread.nearDuplicateReply",
    ]);
    expect(Object.keys(defaultWeights.reddit.features)).toHaveLength(7);
    expect(Object.keys(defaultWeights.bluesky.features)).toHaveLength(8);
    expect(Object.keys(defaultWeights.hackernews.features)).toHaveLength(5);
  });

  it("has a reason template for every feature id it defines", () => {
    const templated = new Set(templatedFeatureIds());
    for (const platform of PLATFORMS) {
      for (const id of Object.keys(defaultWeights[platform].features)) {
        expect(templated.has(id), `${id} has no reason template`).toBe(true);
      }
    }
  });

  it("keeps every bin value and bool weight within the feature cap", () => {
    for (const platform of PLATFORMS) {
      for (const spec of Object.values(defaultWeights[platform].features)) {
        const values: number[] =
          spec.kind === "bins" ? spec.bins.map((bin) => bin[2]) : [spec.weight];
        for (const value of values) {
          expect(Math.abs(value)).toBeLessThanOrEqual(spec.cap);
        }
      }
    }
  });

  it("mirrors the X bins on Bluesky where the signal is the same", () => {
    const pairs: Array<[string, string]> = [
      ["x.postsPerDay", "bsky.postsPerDay"],
      ["x.accountAgeDays", "bsky.accountAgeDays"],
      ["x.followingRatio", "bsky.followsRatio"],
      ["x.defaultAvatarEmptyBio", "bsky.noAvatarEmptyBio"],
    ];
    for (const [xId, bskyId] of pairs) {
      const xSpec: FeatureSpec | undefined = defaultWeights.x.features[xId];
      const bskySpec: FeatureSpec | undefined = defaultWeights.bluesky.features[bskyId];
      expect(bskySpec).toEqual({ ...xSpec });
    }
  });

  it("scores the ADR-0003 example account as many with the X table", () => {
    const verdict: Verdict = scoreAccount(
      [
        feature("x.accountAgeDays", 21, "age", 1),
        feature("x.postsPerDay", 140, "activity", 1),
        feature("x.followingRatio", 377, "graph", 1),
      ],
      signalsWith({ tiersDelivered: ALL_TIERS, values: { following: 4900, followers: 12 } }),
      defaultWeights.x,
      { policyVersion: 1, now: NOW, sourcesAvailable: ALL_TIERS },
    );
    expect(verdict.tier).toBe("many");
    expect(reasonTexts(verdict)).toEqual([
      "Joined 3 weeks ago",
      "~140 posts/day since joining",
      "Following 4,900, followed by 12",
    ]);
  });
});

describe("parseWeightsFile", () => {
  it("accepts the default file", () => {
    const parsed: Record<PlatformId, PlatformWeights> = parseWeightsFile(validFile()).platforms;
    expect(parsed).toEqual(defaultWeights);
  });

  it("rejects the malformed fixture, naming the feature whose bins are missing", () => {
    expect(() => parseWeightsFile(malformedWeights)).toThrow(WeightsFileError);
    expect(() => parseWeightsFile(malformedWeights)).toThrow(
      "Invalid weights file at $.platforms.x.features.x.postsPerDay.bins: expected a non-empty array",
    );
  });

  it("rejects a document that is not an object or has the wrong schema", () => {
    expect(() => parseWeightsFile(null)).toThrow("at $: expected an object");
    expect(() => parseWeightsFile("weights")).toThrow("at $: expected an object");
    expect(() => parseWeightsFile(withPatch((file) => (file.schema = 2)))).toThrow(
      "at $.schema: expected 1",
    );
  });

  it("rejects a missing platform", () => {
    const file: Record<string, unknown> = withPatch((current) => {
      delete (current.platforms as Record<string, unknown>).reddit;
    });
    expect(() => parseWeightsFile(file)).toThrow("at $.platforms.reddit: missing platform");
  });

  it("rejects thresholds that are not ordered", () => {
    const file: Record<string, unknown> = withPatch((current) => {
      platformOf(current, "x").thresholds = { some: 0.6, many: 0.6 };
    });
    expect(() => parseWeightsFile(file)).toThrow(
      "at $.platforms.x.thresholds: some must be below many",
    );
  });

  it("rejects a non-numeric prior, a negative cap and a negative confidence weight", () => {
    expect(() =>
      parseWeightsFile(withPatch((current) => (platformOf(current, "x").prior = "-2.5"))),
    ).toThrow("at $.platforms.x.prior: expected a finite number");
    expect(() =>
      parseWeightsFile(
        withPatch((current) => {
          const features = platformOf(current, "x").features as Record<string, FeatureSpec>;
          features["x.newAndBlue"] = { ...features["x.newAndBlue"]!, cap: -1 };
        }),
      ),
    ).toThrow("at $.platforms.x.features.x.newAndBlue.cap: must not be negative");
    expect(() =>
      parseWeightsFile(
        withPatch((current) => {
          platformOf(current, "x").confidenceWeights = { 0: 0.5, 1: -0.1, 2: 0.5 };
        }),
      ),
    ).toThrow("at $.platforms.x.confidenceWeights.1: must not be negative");
  });

  it("rejects an unknown group, kind or group cap", () => {
    expect(() =>
      parseWeightsFile(
        withPatch((current) => {
          const features = platformOf(current, "x").features as Record<string, unknown>;
          features["x.newAndBlue"] = { group: "vibes", cap: 1, kind: "bool", weight: 1 };
        }),
      ),
    ).toThrow("at $.platforms.x.features.x.newAndBlue.group: expected an independence group");
    expect(() =>
      parseWeightsFile(
        withPatch((current) => {
          const features = platformOf(current, "x").features as Record<string, unknown>;
          features["x.newAndBlue"] = { group: "age", cap: 1, kind: "range", weight: 1 };
        }),
      ),
    ).toThrow('at $.platforms.x.features.x.newAndBlue.kind: expected "bins" or "bool"');
    expect(() =>
      parseWeightsFile(withPatch((current) => (platformOf(current, "x").groupCaps = { vibes: 1 }))),
    ).toThrow("at $.platforms.x.groupCaps.vibes: unknown independence group");
  });

  it("rejects malformed bins", () => {
    const withBins = (bins: unknown): Record<string, unknown> =>
      withPatch((current) => {
        const features = platformOf(current, "x").features as Record<string, unknown>;
        features["x.replyShare"] = { group: "content", cap: 0.8, kind: "bins", bins };
      });
    expect(() => parseWeightsFile(withBins([[0, 1]]))).toThrow(
      "at $.platforms.x.features.x.replyShare.bins[0]: expected a [lo, hi, logOdds] triple",
    );
    expect(() => parseWeightsFile(withBins([[1, 0, 0.5]]))).toThrow(
      "at $.platforms.x.features.x.replyShare.bins[0]: lo must be below hi",
    );
    expect(() => parseWeightsFile(withBins([[0, "1", 0.5]]))).toThrow(
      "at $.platforms.x.features.x.replyShare.bins[0][1]: expected a finite number",
    );
    expect(() => parseWeightsFile(withBins([[null, null, Number.NaN]]))).toThrow(
      "at $.platforms.x.features.x.replyShare.bins[0][2]: expected a finite number",
    );
  });
});
