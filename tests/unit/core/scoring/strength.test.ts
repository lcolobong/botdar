import { REASON_MIN_ABSOLUTE_CONTRIBUTION, selectReasons } from "@/src/core/scoring/reasons";
import { reasonStrength, STRONG_CONTRIBUTION } from "@/src/core/scoring/strength";
import type { Evidence, VerdictReason } from "@/src/core/types";

function evidence(contribution: number, reason: string): Evidence {
  return { feature: "x.postsPerDay", contribution, group: "activity", tier: 0, reason };
}

describe("reasonStrength", () => {
  it("calls a reason strong from the engine's strong threshold upwards", () => {
    expect(reasonStrength(STRONG_CONTRIBUTION)).toBe("strong");
    expect(reasonStrength(2)).toBe("strong");
  });

  it("calls a reason moderate from the reason bar up to the strong threshold", () => {
    expect(reasonStrength(REASON_MIN_ABSOLUTE_CONTRIBUTION)).toBe("moderate");
    expect(reasonStrength(STRONG_CONTRIBUTION - 0.01)).toBe("moderate");
  });

  it("calls a reason weak below the reason bar, zero included", () => {
    expect(reasonStrength(REASON_MIN_ABSOLUTE_CONTRIBUTION - 0.01)).toBe("weak");
    expect(reasonStrength(0)).toBe("weak");
  });

  it("buckets by size, so a reason towards ordinary is graded the same way", () => {
    expect(reasonStrength(-STRONG_CONTRIBUTION)).toBe("strong");
    expect(reasonStrength(-REASON_MIN_ABSOLUTE_CONTRIBUTION)).toBe("moderate");
    expect(reasonStrength(-0.1)).toBe("weak");
  });

  it("gives the declared disclosure, which carries no contribution, no bucket", () => {
    expect(reasonStrength(undefined)).toBeUndefined();
  });

  it("calls weak exactly the rows selectReasons lists only to reach two reasons", () => {
    const strengths = (items: Evidence[]): (string | undefined)[] =>
      selectReasons(items).map((reason: VerdictReason) => reasonStrength(reason.contribution));
    // Nothing clears the bar, so both rows are padding.
    expect(strengths([evidence(0.29, "a"), evidence(-0.1, "b")])).toEqual(["weak", "weak"]);
    // Two clear it, so the weaker item is left out and nothing listed is weak.
    expect(
      strengths([
        evidence(0.9, "a"),
        evidence(REASON_MIN_ABSOLUTE_CONTRIBUTION, "b"),
        evidence(0.2, "c"),
      ]),
    ).toEqual(["strong", "moderate"]);
  });
});
