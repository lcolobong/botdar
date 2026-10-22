import type { AccountSignals, Feature } from "../../../../src/core/types";
import { toFeatures } from "../../../../src/platforms/reddit/features";

const DAY_MILLIS = 86_400_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

function signalsFor(handle: string, partial: Partial<AccountSignals> = {}): AccountSignals {
  return { ref: { platform: "reddit", handle }, provenance: {}, observedAt: NOW, ...partial };
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

describe("reddit toFeatures", () => {
  it("emits only the generated-name feature for a bare reference", () => {
    expect(toFeatures(signalsFor("quiet_lantern"), NOW)).toEqual([
      { id: "reddit.generatedName", value: false, group: "handle", tier: 0 },
    ]);
  });

  it("emits every feature for a fully observed young account", () => {
    const features: Feature[] = toFeatures(
      signalsFor("brave_walrus_4821", {
        createdAt: NOW - 10 * DAY_MILLIS,
        linkKarma: 1500,
        commentKarma: 499,
        hasDefaultAvatar: true,
        hasVerifiedEmail: false,
        provenance: {
          createdAt: 0,
          linkKarma: 2,
          commentKarma: 2,
          hasDefaultAvatar: 2,
          hasVerifiedEmail: 2,
        },
      }),
      NOW,
    );
    expect(features).toEqual([
      { id: "reddit.karmaPerDay", value: 199.9, group: "activity", tier: 2 },
      { id: "reddit.accountAgeDays", value: 10, group: "age", tier: 0 },
      { id: "reddit.postToCommentKarma", value: 3, group: "content", tier: 2 },
      { id: "reddit.generatedName", value: true, group: "handle", tier: 0 },
      { id: "reddit.noAvatar", value: true, group: "profile", tier: 2 },
      { id: "reddit.noVerifiedEmail", value: true, group: "profile", tier: 2 },
    ]);
  });

  describe("gating", () => {
    it("emits karmaPerDay only under 180 days of age with both karma counts", () => {
      const base = { linkKarma: 100, commentKarma: 100 };
      expect(
        ids(toFeatures(signalsFor("a", { ...base, createdAt: NOW - 180 * DAY_MILLIS }), NOW)),
      ).not.toContain("reddit.karmaPerDay");
      expect(
        ids(toFeatures(signalsFor("a", { linkKarma: 100, createdAt: NOW - DAY_MILLIS }), NOW)),
      ).not.toContain("reddit.karmaPerDay");
      const young: Feature[] = toFeatures(
        signalsFor("a", { ...base, createdAt: NOW - 179 * DAY_MILLIS }),
        NOW,
      );
      expect(featureById(young, "reddit.karmaPerDay").value).toBeCloseTo(200 / 179);
    });

    it("divides by at least one day and clamps future cake days to zero age", () => {
      const features: Feature[] = toFeatures(
        signalsFor("a", { createdAt: NOW + DAY_MILLIS, linkKarma: 40, commentKarma: 10 }),
        NOW,
      );
      expect(featureById(features, "reddit.accountAgeDays").value).toBe(0);
      expect(featureById(features, "reddit.karmaPerDay").value).toBe(50);
    });

    it("emits postToCommentKarma only from 500 link karma with comment karma known", () => {
      expect(
        ids(toFeatures(signalsFor("a", { linkKarma: 499, commentKarma: 0 }), NOW)),
      ).not.toContain("reddit.postToCommentKarma");
      expect(ids(toFeatures(signalsFor("a", { linkKarma: 500 }), NOW))).not.toContain(
        "reddit.postToCommentKarma",
      );
      const features: Feature[] = toFeatures(
        signalsFor("a", { linkKarma: 500, commentKarma: 0 }),
        NOW,
      );
      expect(featureById(features, "reddit.postToCommentKarma").value).toBe(500);
    });

    it("emits noAvatar and noVerifiedEmail only when observed", () => {
      expect(ids(toFeatures(signalsFor("a"), NOW))).toEqual(["reddit.generatedName"]);
      const observed: Feature[] = toFeatures(
        signalsFor("a", { hasDefaultAvatar: false, hasVerifiedEmail: true }),
        NOW,
      );
      expect(featureById(observed, "reddit.noAvatar").value).toBe(false);
      expect(featureById(observed, "reddit.noVerifiedEmail").value).toBe(false);
    });
  });

  describe("generated-name shape", () => {
    it.each([
      ["Brave_Walrus_4821", true],
      ["Brave-Walrus-4821", true],
      ["Brave_Walrus4821", true],
      ["Brave_Walrus_48210", false],
      ["brave_Walrus_4821", false],
      ["BRAVE_WALRUS_4821", false],
      ["Brave_Walrus", false],
      ["brave_walrus_4821", true],
      ["brave-walrus-48", true],
      ["bravewalrus4821", false],
      ["brave_walrus_", false],
      ["quiet_lantern", false],
    ])("%s → %s", (handle, expected) => {
      const features: Feature[] = toFeatures(signalsFor(handle), NOW);
      expect(featureById(features, "reddit.generatedName").value).toBe(expected);
    });
  });

  describe("tiers", () => {
    it("takes the highest tier among the fields a feature reads", () => {
      const features: Feature[] = toFeatures(
        signalsFor("a", {
          createdAt: NOW - DAY_MILLIS,
          linkKarma: 1,
          commentKarma: 1,
          provenance: { createdAt: 0, linkKarma: 2, commentKarma: 2 },
        }),
        NOW,
      );
      expect(featureById(features, "reddit.karmaPerDay").tier).toBe(2);
      expect(featureById(features, "reddit.accountAgeDays").tier).toBe(0);
    });
  });
});
