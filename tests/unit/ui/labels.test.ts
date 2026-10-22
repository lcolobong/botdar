import { accessibleLabel, glyphFor, shouldDrawBadge, visibleLabel } from "@/src/ui/labels";

describe("badge labels", () => {
  it("maps every drawn tier to plain and sus wording", () => {
    expect(visibleLabel("many", "plain")).toBe("Likely bot");
    expect(visibleLabel("many", "sus")).toBe("Sus");
    expect(visibleLabel("some", "plain")).toBe("Unsure");
    expect(visibleLabel("some", "sus")).toBe("Kinda sus");
    expect(visibleLabel("declared", "plain")).toBe("Declared bot");
    expect(visibleLabel("declared", "sus")).toBe("Honest self-report bot");
    expect(visibleLabel("typical", "plain")).toBe("Likely human");
    expect(visibleLabel("typical", "sus")).toBe("Real af");
  });

  it("shows no text in the icon style but keeps the plain accessible name", () => {
    expect(visibleLabel("many", "icon")).toBeNull();
    expect(accessibleLabel("many")).toBe("Likely bot");
  });

  it("pairs each tier with its glyph", () => {
    expect(glyphFor("many")).toBe("bot");
    expect(glyphFor("some")).toBe("unsure");
    expect(glyphFor("declared")).toBe("tag");
    expect(glyphFor("typical")).toBe("person");
  });

  it("never draws unknown, and draws typical only when Likely human is on", () => {
    expect(shouldDrawBadge("unknown", true)).toBe(false);
    expect(shouldDrawBadge("typical", false)).toBe(false);
    expect(shouldDrawBadge("typical", true)).toBe(true);
    expect(shouldDrawBadge("many", false)).toBe(true);
  });
});
