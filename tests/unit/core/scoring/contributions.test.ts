import {
  applyGroupCaps,
  clampToCap,
  featureContribution,
  rawContribution,
} from "@/src/core/scoring/contributions";
import type { BinsFeatureSpec, BoolFeatureSpec, GroupCaps } from "@/src/core/scoring/types";

const postsPerDay: BinsFeatureSpec = {
  kind: "bins",
  group: "activity",
  cap: 2.0,
  bins: [
    [0, 10, 0],
    [10, 30, 0.4],
    [30, 75, 1.0],
    [75, 150, 1.5],
    [150, null, 2.0],
  ],
};

const bigramLikelihood: BinsFeatureSpec = {
  kind: "bins",
  group: "handle",
  cap: 0.8,
  bins: [
    [null, -4.5, 0.8],
    [-4.5, -3.8, 0.4],
    [-3.8, null, 0],
  ],
};

const nameDigits: BoolFeatureSpec = { kind: "bool", group: "handle", cap: 0.7, weight: 0.7 };

describe("rawContribution", () => {
  it("returns the log-odds of the first half-open bin containing the value", () => {
    expect(rawContribution(postsPerDay, 0)).toBe(0);
    expect(rawContribution(postsPerDay, 9.99)).toBe(0);
    expect(rawContribution(postsPerDay, 10)).toBe(0.4);
    expect(rawContribution(postsPerDay, 29.5)).toBe(0.4);
    expect(rawContribution(postsPerDay, 30)).toBe(1.0);
    expect(rawContribution(postsPerDay, 149)).toBe(1.5);
  });

  it("treats null bounds as unbounded on that side", () => {
    expect(rawContribution(postsPerDay, 10_000)).toBe(2.0);
    expect(rawContribution(bigramLikelihood, -9)).toBe(0.8);
    expect(rawContribution(bigramLikelihood, -4.5)).toBe(0.4);
    expect(rawContribution(bigramLikelihood, 1)).toBe(0);
  });

  it("contributes 0 when no bin matches", () => {
    expect(rawContribution(postsPerDay, -1)).toBe(0);
    expect(rawContribution(postsPerDay, Number.NaN)).toBe(0);
  });

  it("contributes 0 for a bins spec given a boolean", () => {
    expect(rawContribution(postsPerDay, true)).toBe(0);
  });

  it("contributes the weight only when a bool feature is true", () => {
    expect(rawContribution(nameDigits, true)).toBe(0.7);
    expect(rawContribution(nameDigits, false)).toBe(0);
    expect(rawContribution(nameDigits, 1)).toBe(0);
  });
});

describe("clampToCap", () => {
  it("clamps both signs to the cap", () => {
    expect(clampToCap(3, 1.5)).toBe(1.5);
    expect(clampToCap(-3, 1.5)).toBe(-1.5);
    expect(clampToCap(0.2, 1.5)).toBe(0.2);
    expect(clampToCap(-0.2, 1.5)).toBe(-0.2);
  });

  it("treats a negative cap as its magnitude", () => {
    expect(clampToCap(3, -1.5)).toBe(1.5);
  });
});

describe("featureContribution", () => {
  it("clamps a bin value that exceeds the feature cap", () => {
    const overCapped: BinsFeatureSpec = { ...postsPerDay, cap: 1.2 };
    expect(featureContribution(overCapped, 500)).toBe(1.2);
  });

  it("clamps a bool weight that exceeds the feature cap", () => {
    const overCapped: BoolFeatureSpec = { ...nameDigits, cap: 0.5 };
    expect(featureContribution(overCapped, true)).toBe(0.5);
  });

  it("passes in-cap contributions through unchanged", () => {
    expect(featureContribution(postsPerDay, 40)).toBe(1.0);
  });
});

describe("applyGroupCaps", () => {
  const groupCaps: GroupCaps = { handle: 1.2, profile: 1.2 };

  it("scales positive contributions down so the group sums to its cap", () => {
    const capped = applyGroupCaps(
      [
        { id: "a", group: "handle", contribution: 0.8 },
        { id: "b", group: "handle", contribution: 0.7 },
        { id: "c", group: "handle", contribution: 0.5 },
      ],
      groupCaps,
    );
    const sum: number = capped.reduce((total, item) => total + item.contribution, 0);
    expect(sum).toBeCloseTo(1.2, 10);
    expect(capped[0]?.contribution).toBeCloseTo(0.48, 10);
    expect(capped[1]?.contribution).toBeCloseTo(0.42, 10);
    expect(capped[2]?.contribution).toBeCloseTo(0.3, 10);
    expect(capped[0]?.id).toBe("a");
  });

  it("leaves a group under its cap alone", () => {
    const items = [
      { group: "handle" as const, contribution: 0.7 },
      { group: "handle" as const, contribution: 0.4 },
    ];
    expect(applyGroupCaps(items, groupCaps)).toEqual(items);
  });

  it("ignores groups without a cap", () => {
    const items = [
      { group: "activity" as const, contribution: 2.0 },
      { group: "activity" as const, contribution: 2.0 },
    ];
    expect(applyGroupCaps(items, groupCaps)).toEqual(items);
  });

  it("does not scale or count negative contributions", () => {
    const capped = applyGroupCaps(
      [
        { group: "profile" as const, contribution: 1.0 },
        { group: "profile" as const, contribution: 0.8 },
        { group: "profile" as const, contribution: -0.5 },
      ],
      groupCaps,
    );
    expect(capped[2]?.contribution).toBe(-0.5);
    const positiveSum: number = capped
      .filter((item) => item.contribution > 0)
      .reduce((total, item) => total + item.contribution, 0);
    expect(positiveSum).toBeCloseTo(1.2, 10);
  });

  it("caps each group independently", () => {
    const capped = applyGroupCaps(
      [
        { group: "handle" as const, contribution: 1.0 },
        { group: "handle" as const, contribution: 1.0 },
        { group: "profile" as const, contribution: 1.0 },
      ],
      groupCaps,
    );
    expect(capped[0]?.contribution).toBeCloseTo(0.6, 10);
    expect(capped[2]?.contribution).toBe(1.0);
  });

  it("returns an empty list unchanged", () => {
    expect(applyGroupCaps([], groupCaps)).toEqual([]);
  });
});
