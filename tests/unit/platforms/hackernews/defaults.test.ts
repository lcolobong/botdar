import { buildDefaults } from "@/src/core/policy/defaults";

describe("Hacker News build defaults", () => {
  it("declare no Tier 1, which the policy merge can then never switch on", () => {
    expect(buildDefaults.hackernews.tiers).toEqual({ t1: false, t2: true });
    expect(buildDefaults.hackernews.rateLimitPerMinute).toBe(30);
  });
});
