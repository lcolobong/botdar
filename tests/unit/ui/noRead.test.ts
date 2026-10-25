import { allNoReadExplanations, noReadExplanation } from "@/src/ui/noRead";

describe("noReadExplanation", () => {
  it("names why there is no read for each lookup status", () => {
    expect(noReadExplanation("off")).toMatch(/^Profile lookups are off, by conservative mode/);
    expect(noReadExplanation("loginRequired")).toMatch(/only while you are logged in/);
    expect(noReadExplanation("empty")).toMatch(/^The platform returned no profile details/);
    expect(noReadExplanation("delivered")).toMatch(/returned too little/);
    expect(noReadExplanation("idle")).toMatch(/has not been looked up yet/);
    expect(noReadExplanation("pending")).toBe("Loading this account's public profile.");
  });

  it("follows the card wording rules", () => {
    for (const line of allNoReadExplanations()) {
      expect(line).not.toMatch(/bot|verified human|%/i);
      expect(line).toMatch(/^[A-Z].*\.$/);
    }
  });
});
