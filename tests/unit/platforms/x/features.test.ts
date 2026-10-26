import type { AccountSignals, Feature } from "../../../../src/core/types";
import { toFeatures } from "../../../../src/platforms/x/features";

const DAY_MILLIS = 86_400_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

function signalsFor(handle: string, partial: Partial<AccountSignals> = {}): AccountSignals {
  return {
    ref: { platform: "x", handle },
    provenance: {},
    tiersDelivered: [],
    observedAt: NOW,
    ...partial,
  };
}

function featureById(features: Feature[], id: string): Feature {
  const feature: Feature | undefined = features.find((candidate) => candidate.id === id);
  if (feature === undefined) {
    throw new Error(`feature ${id} not emitted`);
  }
  return feature;
}

function ids(features: Feature[]): string[] {
  return features.map((feature) => feature.id);
}

describe("x toFeatures", () => {
  it("emits only the handle features for a bare reference", () => {
    const features: Feature[] = toFeatures(signalsFor("alice_example"), NOW, "US");
    expect(ids(features)).toEqual([
      "x.handleNameDigits",
      "x.handleTrailingDigits",
      "x.handleBigramLL",
    ]);
    expect(featureById(features, "x.handleNameDigits")).toEqual({
      id: "x.handleNameDigits",
      value: false,
      group: "handle",
      tier: 0,
    });
    expect(featureById(features, "x.handleTrailingDigits").value).toBe(0);
  });

  it("emits every feature for a fully observed account", () => {
    const features: Feature[] = toFeatures(
      signalsFor("kai09127364", {
        createdAt: NOW - 30 * DAY_MILLIS,
        followers: 12,
        following: 2400,
        postCount: 9000,
        bio: "",
        hasDefaultAvatar: true,
        verified: "blue",
        replyShare: { ratio: 0.95, sampleSize: 40 },
        usernameChanges: 3,
        country: "United States",
        provenance: {
          createdAt: 1,
          followers: 1,
          following: 1,
          postCount: 1,
          bio: 1,
          hasDefaultAvatar: 0,
          verified: 1,
          replyShare: 0,
          usernameChanges: 2,
          country: 2,
        },
      }),
      NOW,
      "GB",
    );
    expect(ids(features)).toEqual([
      "x.postsPerDay",
      "x.accountAgeDays",
      "x.followingRatio",
      "x.handleNameDigits",
      "x.handleTrailingDigits",
      "x.defaultAvatarEmptyBio",
      "x.newAndBlue",
      "x.replyShare",
      "x.usernameChanges",
      "x.countryLocaleMismatch",
    ]);
    expect(featureById(features, "x.postsPerDay")).toEqual({
      id: "x.postsPerDay",
      value: 300,
      group: "activity",
      tier: 1,
    });
    expect(featureById(features, "x.accountAgeDays")).toEqual({
      id: "x.accountAgeDays",
      value: 30,
      group: "age",
      tier: 1,
    });
    expect(featureById(features, "x.followingRatio").value).toBeCloseTo(2400 / 13);
    expect(featureById(features, "x.followingRatio").group).toBe("graph");
    expect(featureById(features, "x.handleNameDigits").value).toBe(true);
    expect(featureById(features, "x.handleTrailingDigits").value).toBe(8);
    expect(featureById(features, "x.defaultAvatarEmptyBio")).toEqual({
      id: "x.defaultAvatarEmptyBio",
      value: 2,
      group: "profile",
      tier: 1,
    });
    expect(featureById(features, "x.newAndBlue")).toEqual({
      id: "x.newAndBlue",
      value: true,
      group: "verification",
      tier: 1,
    });
    expect(featureById(features, "x.replyShare")).toEqual({
      id: "x.replyShare",
      value: 0.95,
      group: "content",
      tier: 0,
    });
    expect(featureById(features, "x.usernameChanges")).toEqual({
      id: "x.usernameChanges",
      value: 3,
      group: "profile",
      tier: 2,
    });
    expect(featureById(features, "x.countryLocaleMismatch")).toEqual({
      id: "x.countryLocaleMismatch",
      value: true,
      group: "geo",
      tier: 2,
    });
  });

  describe("gating", () => {
    it("needs both createdAt and postCount for postsPerDay", () => {
      expect(ids(toFeatures(signalsFor("a", { postCount: 10 }), NOW))).not.toContain(
        "x.postsPerDay",
      );
      expect(ids(toFeatures(signalsFor("a", { createdAt: NOW - DAY_MILLIS }), NOW))).toContain(
        "x.accountAgeDays",
      );
      expect(ids(toFeatures(signalsFor("a", { createdAt: NOW - DAY_MILLIS }), NOW))).not.toContain(
        "x.postsPerDay",
      );
    });

    it("divides by at least one day and clamps future join dates to zero age", () => {
      const features: Feature[] = toFeatures(
        signalsFor("a", { createdAt: NOW + DAY_MILLIS, postCount: 50 }),
        NOW,
      );
      expect(featureById(features, "x.accountAgeDays").value).toBe(0);
      expect(featureById(features, "x.postsPerDay").value).toBe(50);
    });

    it("emits followingRatio only when following is at least 100 and followers is known", () => {
      expect(ids(toFeatures(signalsFor("a", { following: 99, followers: 0 }), NOW))).not.toContain(
        "x.followingRatio",
      );
      expect(ids(toFeatures(signalsFor("a", { following: 100 }), NOW))).not.toContain(
        "x.followingRatio",
      );
      const features: Feature[] = toFeatures(
        signalsFor("a", { following: 100, followers: 0 }),
        NOW,
      );
      expect(featureById(features, "x.followingRatio").value).toBe(100);
    });

    it("counts the empty-profile fields only when both are observed", () => {
      expect(ids(toFeatures(signalsFor("a", { hasDefaultAvatar: true }), NOW))).not.toContain(
        "x.defaultAvatarEmptyBio",
      );
      expect(ids(toFeatures(signalsFor("a", { bio: "" }), NOW))).not.toContain(
        "x.defaultAvatarEmptyBio",
      );
      const one: Feature[] = toFeatures(
        signalsFor("a", { hasDefaultAvatar: false, bio: "  " }),
        NOW,
      );
      expect(featureById(one, "x.defaultAvatarEmptyBio").value).toBe(1);
      const none: Feature[] = toFeatures(
        signalsFor("a", { hasDefaultAvatar: false, bio: "hi" }),
        NOW,
      );
      expect(featureById(none, "x.defaultAvatarEmptyBio").value).toBe(0);
    });

    it("emits newAndBlue only with both verified and createdAt, false past 90 days or without blue", () => {
      expect(ids(toFeatures(signalsFor("a", { verified: "blue" }), NOW))).not.toContain(
        "x.newAndBlue",
      );
      const old: Feature[] = toFeatures(
        signalsFor("a", { verified: "blue", createdAt: NOW - 90 * DAY_MILLIS }),
        NOW,
      );
      expect(featureById(old, "x.newAndBlue").value).toBe(false);
      const org: Feature[] = toFeatures(
        signalsFor("a", { verified: "org", createdAt: NOW - DAY_MILLIS }),
        NOW,
      );
      expect(featureById(org, "x.newAndBlue").value).toBe(false);
    });

    it("emits replyShare only from a sample of at least 20", () => {
      expect(
        ids(toFeatures(signalsFor("a", { replyShare: { ratio: 1, sampleSize: 19 } }), NOW)),
      ).not.toContain("x.replyShare");
      const features: Feature[] = toFeatures(
        signalsFor("a", { replyShare: { ratio: 1, sampleSize: 20 } }),
        NOW,
      );
      expect(featureById(features, "x.replyShare").value).toBe(1);
    });

    it("emits usernameChanges only when Tier 2 delivered it", () => {
      expect(ids(toFeatures(signalsFor("a"), NOW))).not.toContain("x.usernameChanges");
      const features: Feature[] = toFeatures(
        signalsFor("a", { usernameChanges: 0, provenance: { usernameChanges: 2 } }),
        NOW,
      );
      expect(featureById(features, "x.usernameChanges")).toEqual({
        id: "x.usernameChanges",
        value: 0,
        group: "profile",
        tier: 2,
      });
    });

    it("compares the About country with the locale region, tolerating case and accents", () => {
      const match: Feature[] = toFeatures(signalsFor("a", { country: "united states" }), NOW, "US");
      expect(featureById(match, "x.countryLocaleMismatch").value).toBe(false);
      const mismatch: Feature[] = toFeatures(signalsFor("a", { country: "Brazil" }), NOW, "US");
      expect(featureById(mismatch, "x.countryLocaleMismatch").value).toBe(true);
      const accented: Feature[] = toFeatures(signalsFor("a", { country: "Turkiye" }), NOW, "TR");
      expect(featureById(accented, "x.countryLocaleMismatch").value).toBe(false);
    });

    it("omits countryLocaleMismatch without a country or with a bad region", () => {
      expect(ids(toFeatures(signalsFor("a"), NOW, "US"))).not.toContain("x.countryLocaleMismatch");
      expect(
        ids(toFeatures(signalsFor("a", { country: "Brazil" }), NOW, "not a region")),
      ).not.toContain("x.countryLocaleMismatch");
    });

    it("reads the region from navigator.language and never infers one from a bare language", () => {
      vi.stubGlobal("navigator", { language: "pt-BR" });
      try {
        const features: Feature[] = toFeatures(signalsFor("a", { country: "Brazil" }), NOW);
        expect(featureById(features, "x.countryLocaleMismatch").value).toBe(false);
        vi.stubGlobal("navigator", { language: "en" });
        expect(ids(toFeatures(signalsFor("a", { country: "Brazil" }), NOW))).not.toContain(
          "x.countryLocaleMismatch",
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("handle shape", () => {
    it.each([
      ["john12345", true, 5],
      ["john1234", false, 4],
      ["john_12345", false, 5],
      ["12345", false, 5],
      ["johnsmith", false, 0],
      ["a1b2c3", false, 1],
    ])("%s → nameDigits %s, trailing %i", (handle, nameDigits, trailing) => {
      const features: Feature[] = toFeatures(signalsFor(handle), NOW);
      expect(featureById(features, "x.handleNameDigits").value).toBe(nameDigits);
      expect(featureById(features, "x.handleTrailingDigits").value).toBe(trailing);
    });

    it("emits the bigram likelihood only for handles with at least four letters", () => {
      expect(ids(toFeatures(signalsFor("ab12345"), NOW))).not.toContain("x.handleBigramLL");
      const natural: Feature[] = toFeatures(signalsFor("alice_example"), NOW);
      const random: Feature[] = toFeatures(signalsFor("xq7zk2pv9w"), NOW);
      expect(featureById(natural, "x.handleBigramLL")).toMatchObject({
        group: "handle",
        tier: 0,
      });
      expect(featureById(natural, "x.handleBigramLL").value).toBeGreaterThan(
        featureById(random, "x.handleBigramLL").value as number,
      );
    });
  });

  describe("tiers", () => {
    it("takes the highest tier among the fields a feature reads", () => {
      const features: Feature[] = toFeatures(
        signalsFor("a", {
          createdAt: NOW - DAY_MILLIS,
          postCount: 1,
          provenance: { createdAt: 0, postCount: 1 },
        }),
        NOW,
      );
      expect(featureById(features, "x.postsPerDay").tier).toBe(1);
      expect(featureById(features, "x.accountAgeDays").tier).toBe(0);
    });

    it("defaults to tier 0 when provenance has no record", () => {
      const features: Feature[] = toFeatures(signalsFor("a", { createdAt: NOW - DAY_MILLIS }), NOW);
      expect(featureById(features, "x.accountAgeDays").tier).toBe(0);
    });
  });
});
