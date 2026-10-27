import type { AccountSignals, Feature } from "../../../../src/core/types";
import { toFeatures } from "../../../../src/platforms/x/features";

const DAY_MILLIS = 86_400_000;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const RUSSIAN_POSTS =
  "Я учитель и мама двоих детей. Здесь я пишу о книгах, путешествиях и о том, что происходит в моем городе.";
const SPANISH_BIO =
  "Periodista y lectora. Escribo sobre ciencia y tecnología para que todo el mundo pueda entender lo que pasa.";
const PORTUGUESE_BIO =
  "Professora de história e mãe de dois. Aqui eu falo sobre livros, viagens e tudo o que me faz pensar.";
const ENGLISH_BIO =
  "Coffee first, then code. I write about the small tools that make our work easier and I share what I learn.";

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
    const features: Feature[] = toFeatures(signalsFor("alice_example"), NOW, []);
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
        postText: RUSSIAN_POSTS,
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
      [],
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
      detail: "ru",
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

    const mismatchOf = (
      partial: Partial<AccountSignals>,
      locales: string[] = [],
    ): boolean | number | undefined =>
      toFeatures(signalsFor("a", partial), NOW, locales).find(
        (feature) => feature.id === "x.countryLocaleMismatch",
      )?.value;

    it("compares the About country with the account's own language", () => {
      expect(mismatchOf({ country: "Spain", bio: SPANISH_BIO })).toBe(false);
      expect(mismatchOf({ country: "Argentina", bio: SPANISH_BIO })).toBe(false);
      expect(mismatchOf({ country: "Russia", bio: SPANISH_BIO })).toBe(true);
      expect(mismatchOf({ country: "united states", postText: RUSSIAN_POSTS })).toBe(true);
      expect(mismatchOf({ country: "Nigeria", bio: ENGLISH_BIO })).toBeUndefined();
      expect(mismatchOf({ country: "Germany", bio: ENGLISH_BIO })).toBeUndefined();
    });

    it("reads the bio and the post text together", () => {
      const shortBio: Partial<AccountSignals> = { country: "Brazil", bio: "Mãe, professora." };
      expect(mismatchOf(shortBio)).toBeUndefined();
      expect(mismatchOf({ ...shortBio, postText: RUSSIAN_POSTS })).toBe(true);
    });

    it("never compares against the viewer's locale", () => {
      vi.stubGlobal("navigator", { language: "en-US" });
      try {
        const features: Feature[] = toFeatures(
          signalsFor("a", { country: "Brazil", bio: PORTUGUESE_BIO }),
          NOW,
        );
        expect(featureById(features, "x.countryLocaleMismatch").value).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("reads a country name printed in the display language", () => {
      expect(mismatchOf({ country: "Brasilien", bio: PORTUGUESE_BIO }, ["de-DE"])).toBe(false);
      expect(mismatchOf({ country: "Brasilien", bio: PORTUGUESE_BIO })).toBeUndefined();
    });

    it("omits countryLocaleMismatch without a country, a language or a readable country", () => {
      expect(mismatchOf({ bio: SPANISH_BIO })).toBeUndefined();
      expect(mismatchOf({ country: "Spain" })).toBeUndefined();
      expect(mismatchOf({ country: "Spain", bio: "Periodista." })).toBeUndefined();
      expect(mismatchOf({ country: "Europe", bio: SPANISH_BIO })).toBeUndefined();
    });

    it("takes the tier of the About lookup", () => {
      const features: Feature[] = toFeatures(
        signalsFor("a", {
          country: "Russia",
          bio: SPANISH_BIO,
          provenance: { country: 2, bio: 1 },
        }),
        NOW,
        [],
      );
      expect(featureById(features, "x.countryLocaleMismatch")).toEqual({
        id: "x.countryLocaleMismatch",
        value: true,
        group: "geo",
        tier: 2,
        detail: "es",
      });
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

describe("x cadence", () => {
  const roundTheClock: number[] = Array.from(
    { length: 100 },
    (_, index) => NOW - index * 110 * 60_000,
  );

  it("emits both timing features at the tier that supplied the post times", () => {
    const features: Feature[] = toFeatures(
      signalsFor("a", { postTimestamps: roundTheClock, provenance: { postTimestamps: 1 } }),
      NOW,
      [],
    );
    expect(featureById(features, "x.gapRegularity")).toEqual({
      id: "x.gapRegularity",
      value: 0,
      group: "timing",
      tier: 1,
    });
    expect(featureById(features, "x.noSleepWindow")).toEqual({
      id: "x.noSleepWindow",
      value: 0,
      group: "timing",
      tier: 1,
    });
  });

  it("emits gap regularity alone when the posts span under a week", () => {
    const threeDays: number[] = roundTheClock.map((timestamp) => NOW - (NOW - timestamp) / 2.5);
    const features: Feature[] = toFeatures(signalsFor("a", { postTimestamps: threeDays }), NOW, []);
    expect(ids(features)).toContain("x.gapRegularity");
    expect(ids(features)).not.toContain("x.noSleepWindow");
  });

  it("leaves a declared account out of timing", () => {
    const features: Feature[] = toFeatures(
      signalsFor("a", { postTimestamps: roundTheClock, declaredAutomated: true }),
      NOW,
      [],
    );
    expect(ids(features)).not.toContain("x.gapRegularity");
    expect(ids(features)).not.toContain("x.noSleepWindow");
  });

  it("leaves accounts verified as an organisation or a government out of timing", () => {
    for (const verified of ["org", "gov"] as const) {
      const features: Feature[] = toFeatures(
        signalsFor("a", { postTimestamps: roundTheClock, verified }),
        NOW,
        [],
      );
      expect(ids(features)).not.toContain("x.gapRegularity");
      expect(ids(features)).not.toContain("x.noSleepWindow");
    }
    const blue: Feature[] = toFeatures(
      signalsFor("a", { postTimestamps: roundTheClock, verified: "blue" }),
      NOW,
      [],
    );
    expect(ids(blue)).toContain("x.gapRegularity");
  });
});
