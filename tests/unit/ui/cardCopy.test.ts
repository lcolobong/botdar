import { cardFixedStrings, markerLabel } from "@/src/ui/cardCopy";

// The card's own fixed copy follows the same wording rules as the core templates
// (tests/unit/core/scoring/reasons.test.ts); it is checked here so core tests never import the UI.
describe("cardFixedStrings", () => {
  it("never says bot and never shows a percentage", () => {
    const strings: string[] = cardFixedStrings();
    expect(strings.length).toBeGreaterThan(0);
    for (const text of strings) {
      expect(text).not.toMatch(/bot/i);
      expect(text).not.toContain("%");
    }
  });

  it("covers every marker name", () => {
    expect(cardFixedStrings()).toEqual(
      expect.arrayContaining([
        "Points towards automated",
        "Weak, points towards ordinary",
        "Moderate, points towards automated",
        "Strong, points towards ordinary",
      ]),
    );
  });
});

describe("markerLabel", () => {
  it("names the strength first, then the direction", () => {
    expect(markerLabel("automated", "strong")).toBe("Strong, points towards automated");
    expect(markerLabel("ordinary", undefined)).toBe("Points towards ordinary");
  });
});
