import type { AccountSignals, Feature } from "../../../../src/core/types";
import { toFeatures } from "../../../../src/platforms/bluesky/features";

const DAY_MILLIS = 86_400_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

function signalsFor(handle: string, partial: Partial<AccountSignals> = {}): AccountSignals {
  return { ref: { platform: "bluesky", handle }, provenance: {}, observedAt: NOW, ...partial };
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

describe("bluesky toFeatures", () => {
  it("emits only the handle feature for a bare reference", () => {
    expect(toFeatures(signalsFor("alice.example.com"), NOW)).toEqual([
      { id: "bsky.handleDigitsOnBskySocial", value: false, group: "handle", tier: 0 },
    ]);
  });

  it("emits every feature for a fully observed account", () => {
    const features: Feature[] = toFeatures(
      signalsFor("kai09127364.bsky.social", {
        createdAt: NOW - 20 * DAY_MILLIS,
        followers: 12,
        following: 2400,
        postCount: 8900,
        bio: "",
        hasDefaultAvatar: true,
        verified: "none",
        declaredAutomated: true,
        provenance: {
          createdAt: 1,
          followers: 2,
          following: 2,
          postCount: 2,
          bio: 2,
          hasDefaultAvatar: 1,
          verified: 1,
          declaredAutomated: 1,
        },
      }),
      NOW,
    );
    expect(features).toEqual([
      { id: "bsky.postsPerDay", value: 445, group: "activity", tier: 2 },
      { id: "bsky.accountAgeDays", value: 20, group: "age", tier: 1 },
      { id: "bsky.followsRatio", value: 2400 / 13, group: "graph", tier: 2 },
      { id: "bsky.handleDigitsOnBskySocial", value: true, group: "handle", tier: 0 },
      { id: "bsky.noAvatarEmptyBio", value: 2, group: "profile", tier: 2 },
    ]);
  });

  it("never emits a declared-bot feature; the engine reads the signal directly", () => {
    const features: Feature[] = toFeatures(
      signalsFor("a.example", { declaredAutomated: true }),
      NOW,
    );
    expect(ids(features)).toEqual(["bsky.handleDigitsOnBskySocial"]);
  });

  describe("gating", () => {
    it("needs both createdAt and postCount for postsPerDay", () => {
      expect(ids(toFeatures(signalsFor("a.example", { postCount: 10 }), NOW))).not.toContain(
        "bsky.postsPerDay",
      );
      const ageOnly: Feature[] = toFeatures(
        signalsFor("a.example", { createdAt: NOW - DAY_MILLIS }),
        NOW,
      );
      expect(ids(ageOnly)).toEqual(["bsky.accountAgeDays", "bsky.handleDigitsOnBskySocial"]);
    });

    it("divides by at least one day and clamps future join dates to zero age", () => {
      const features: Feature[] = toFeatures(
        signalsFor("a.example", { createdAt: NOW + DAY_MILLIS, postCount: 50 }),
        NOW,
      );
      expect(featureById(features, "bsky.accountAgeDays").value).toBe(0);
      expect(featureById(features, "bsky.postsPerDay").value).toBe(50);
    });

    it("emits followsRatio only when following is at least 100 and followers is known", () => {
      expect(
        ids(toFeatures(signalsFor("a.example", { following: 99, followers: 0 }), NOW)),
      ).not.toContain("bsky.followsRatio");
      expect(ids(toFeatures(signalsFor("a.example", { following: 100 }), NOW))).not.toContain(
        "bsky.followsRatio",
      );
      const features: Feature[] = toFeatures(
        signalsFor("a.example", { following: 100, followers: 0 }),
        NOW,
      );
      expect(featureById(features, "bsky.followsRatio").value).toBe(100);
    });

    it("counts the empty-profile fields only when both are observed", () => {
      expect(
        ids(toFeatures(signalsFor("a.example", { hasDefaultAvatar: true }), NOW)),
      ).not.toContain("bsky.noAvatarEmptyBio");
      expect(ids(toFeatures(signalsFor("a.example", { bio: "" }), NOW))).not.toContain(
        "bsky.noAvatarEmptyBio",
      );
      const one: Feature[] = toFeatures(
        signalsFor("a.example", { hasDefaultAvatar: false, bio: "  " }),
        NOW,
      );
      expect(featureById(one, "bsky.noAvatarEmptyBio").value).toBe(1);
      const none: Feature[] = toFeatures(
        signalsFor("a.example", { hasDefaultAvatar: false, bio: "hi" }),
        NOW,
      );
      expect(featureById(none, "bsky.noAvatarEmptyBio").value).toBe(0);
    });
  });

  describe("handle shape", () => {
    // The shared helper (src/core/handle/shape.ts) fires from three digits anywhere in the local part.
    it.each([
      ["kai09127364.bsky.social", true],
      ["kai1234.bsky.social", true],
      ["kai123.bsky.social", true],
      ["kai-1234.bsky.social", true],
      ["kai12.bsky.social", false],
      ["kai.bsky.social", false],
      ["kai09127364.example.com", false],
      ["kai09127364.bsky.social.example.com", false],
      ["handle.invalid", false],
    ])("%s → %s", (handle, expected) => {
      const features: Feature[] = toFeatures(signalsFor(handle), NOW);
      expect(featureById(features, "bsky.handleDigitsOnBskySocial").value).toBe(expected);
    });
  });

  describe("tiers", () => {
    it("takes the highest tier among the fields a feature reads", () => {
      const features: Feature[] = toFeatures(
        signalsFor("a.example", {
          createdAt: NOW - DAY_MILLIS,
          postCount: 1,
          provenance: { createdAt: 1, postCount: 2 },
        }),
        NOW,
      );
      expect(featureById(features, "bsky.postsPerDay").tier).toBe(2);
      expect(featureById(features, "bsky.accountAgeDays").tier).toBe(1);
    });

    it("defaults to tier 0 when provenance has no record", () => {
      const features: Feature[] = toFeatures(
        signalsFor("a.example", { createdAt: NOW - DAY_MILLIS }),
        NOW,
      );
      expect(featureById(features, "bsky.accountAgeDays").tier).toBe(0);
    });
  });
});
