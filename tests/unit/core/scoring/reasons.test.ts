import {
  NO_REASON,
  allFixedStrings,
  caveatFor,
  confidenceNoteFor,
  renderReason,
  selectReasons,
  templatedFeatureIds,
} from "@/src/core/scoring/reasons";
import type { ReasonContext } from "@/src/core/scoring/reasons";
import type { AccountSignals, Evidence } from "@/src/core/types";
import { DAY_MS, NOW, signalsWith } from "./testWeights";

const THREE_WEEKS_AGO: number = NOW - 21 * DAY_MS;
const MARCH_2019: number = Date.UTC(2019, 2, 15);

function render(
  featureId: string,
  value: number | boolean,
  overrides: Partial<ReasonContext> = {},
): string {
  return renderReason(featureId, {
    value,
    contribution: 1,
    signals: signalsWith(),
    now: NOW,
    ...overrides,
  });
}

function evidence(feature: string, contribution: number, group: Evidence["group"]): Evidence {
  return { feature, contribution, group, tier: 0, reason: `reason:${feature}` };
}

describe("reason templates", () => {
  it("renders posting rate with a whole number", () => {
    expect(render("x.postsPerDay", 143.2)).toBe("~143 posts/day since joining");
    expect(render("bsky.postsPerDay", 1500)).toBe("~1,500 posts/day since joining");
  });

  it("renders a recent join date relatively", () => {
    expect(render("x.accountAgeDays", 21)).toBe("Joined 3 weeks ago");
    expect(render("x.accountAgeDays", 5)).toBe("Joined 5 days ago");
    expect(render("x.accountAgeDays", 1)).toBe("Joined 1 day ago");
    expect(render("reddit.accountAgeDays", 75)).toBe("Joined 2 months ago");
  });

  it("renders a join date of 90 days or more as a month and year", () => {
    const signals: AccountSignals = signalsWith({ values: { createdAt: MARCH_2019 } });
    expect(render("x.accountAgeDays", 120, { contribution: 0.2, signals })).toBe(
      "Joined March 2019",
    );
  });

  it("falls back to a relative date when createdAt is not in the signals", () => {
    expect(render("bsky.accountAgeDays", 400, { contribution: 0 })).toBe("Joined 1 year ago");
  });

  it("renders negative age evidence as how old the account is", () => {
    expect(render("x.accountAgeDays", 2190, { contribution: -0.5 })).toBe("Account is 6 years old");
  });

  it("renders the follow counts with thousands separators", () => {
    const signals: AccountSignals = signalsWith({ values: { following: 4900, followers: 12 } });
    expect(render("x.followingRatio", 408, { signals })).toBe("Following 4,900, followed by 12");
    expect(render("bsky.followsRatio", 408)).toBe("Follows many more accounts than follow it back");
  });

  it("counts the trailing digits of the handle for the digit templates", () => {
    expect(
      render("x.handleNameDigits", true, { signals: signalsWith({ handle: "john12345" }) }),
    ).toBe("Handle is a name followed by 5 digits");
    expect(render("x.handleTrailingDigits", 6)).toBe("Handle is a name followed by 6 digits");
    expect(
      render("bsky.handleDigitsOnBskySocial", true, {
        signals: signalsWith({ handle: "jane1234.bsky.social" }),
      }),
    ).toBe("Handle is a name followed by 4 digits");
  });

  it("describes which of avatar and bio are missing", () => {
    expect(render("x.defaultAvatarEmptyBio", 2)).toBe("No profile photo and no bio");
    const noAvatar: AccountSignals = signalsWith({ values: { hasDefaultAvatar: true, bio: "hi" } });
    expect(render("x.defaultAvatarEmptyBio", 1, { signals: noAvatar })).toBe("No profile photo");
    const noBio: AccountSignals = signalsWith({ values: { hasDefaultAvatar: false, bio: "" } });
    expect(render("bsky.noAvatarEmptyBio", 1, { signals: noBio })).toBe("No bio");
    expect(render("bsky.noAvatarEmptyBio", 0)).toBe("Has a profile photo and a bio");
  });

  it("renders verification relative to the join date", () => {
    const signals: AccountSignals = signalsWith({ values: { createdAt: THREE_WEEKS_AGO } });
    expect(render("x.newAndBlue", true, { signals })).toBe("Verified within 3 weeks of joining");
    expect(render("x.newAndBlue", true)).toBe("Verified soon after joining");
  });

  it("renders the reply share as a percentage", () => {
    expect(render("x.replyShare", 0.954)).toBe("95% of recent posts are replies");
  });

  it("renders username changes and country", () => {
    expect(render("x.usernameChanges", 3)).toBe("Username changed 3 times");
    expect(render("x.usernameChanges", 1)).toBe("Username changed 1 time");
    const signals: AccountSignals = signalsWith({ values: { country: "Nigeria" } });
    expect(render("x.countryLocaleMismatch", true, { signals })).toBe("Account based in Nigeria");
  });

  it("renders Reddit karma templates", () => {
    const signals: AccountSignals = signalsWith({
      values: { createdAt: THREE_WEEKS_AGO, linkKarma: 12_000, commentKarma: 15 },
    });
    expect(render("reddit.karmaPerDay", 300, { signals })).toBe(
      "~300 karma/day on a 3-week-old account",
    );
    expect(render("reddit.karmaPerDay", 300)).toBe("~300 karma/day since joining");
    expect(render("reddit.postToCommentKarma", 750, { signals })).toBe(
      "Post karma 12,000, comment karma 15",
    );
  });

  it("renders the fixed Reddit and handle strings", () => {
    expect(render("x.handleBigramLL", -5)).toBe("Handle looks randomly generated");
    expect(render("reddit.generatedName", true)).toBe(
      "Username matches Reddit's auto-generated pattern",
    );
    expect(render("reddit.noAvatar", true)).toBe("Default avatar");
    expect(render("reddit.noVerifiedEmail", true)).toBe("No verified email");
  });

  it("words evidence that points towards an ordinary account", () => {
    const signals: AccountSignals = signalsWith({
      values: { createdAt: MARCH_2019, following: 120, followers: 900 },
    });
    expect(render("reddit.accountAgeDays", 2780, { contribution: -0.6, signals })).toBe(
      "Account is 8 years old",
    );
    expect(render("x.followingRatio", 0.13, { contribution: -0.3, signals })).toBe(
      "Followed by 900, following 120",
    );
    expect(render("bsky.followsRatio", 0.13, { contribution: -0.3 })).toBe(
      "Followed by more accounts than it follows",
    );
    expect(render("reddit.noAvatar", false, { contribution: 0 })).toBe("Custom avatar");
    expect(render("reddit.noVerifiedEmail", false, { contribution: 0 })).toBe("Verified email");
    expect(render("x.defaultAvatarEmptyBio", 0, { contribution: 0 })).toBe(
      "Has a profile photo and a bio",
    );
  });

  it("has nothing to say about a pattern that is absent", () => {
    expect(render("reddit.generatedName", false, { contribution: 0 })).toBe(NO_REASON);
    expect(render("x.handleNameDigits", false, { contribution: 0 })).toBe(NO_REASON);
    expect(render("x.handleTrailingDigits", 2, { contribution: 0 })).toBe(NO_REASON);
    expect(render("bsky.handleDigitsOnBskySocial", false, { contribution: 0 })).toBe(NO_REASON);
    expect(render("x.handleBigramLL", -2, { contribution: 0 })).toBe(NO_REASON);
    expect(render("x.newAndBlue", false, { contribution: 0 })).toBe(NO_REASON);
    expect(render("x.countryLocaleMismatch", false, { contribution: 0 })).toBe(NO_REASON);
  });

  it("renders the feature id when no template exists", () => {
    expect(render("x.somethingNew", 1)).toBe("x.somethingNew");
  });
});

describe("wording rules", () => {
  const contexts: Array<Partial<ReasonContext>> = [
    {},
    { contribution: -1 },
    {
      signals: signalsWith({
        handle: "robot9999.bsky.social",
        values: {
          createdAt: MARCH_2019,
          following: 10,
          followers: 10,
          hasDefaultAvatar: true,
          bio: "",
          country: "France",
          linkKarma: 1,
          commentKarma: 1,
        },
      }),
    },
  ];

  it("never says bot in any template, caveat or note", () => {
    const rendered: string[] = templatedFeatureIds().flatMap((id) =>
      [0, 1, 2, 21, 3000, true, false].flatMap((value) =>
        contexts.map((overrides) => render(id, value, overrides)),
      ),
    );
    const strings: string[] = [
      ...rendered,
      ...allFixedStrings(),
      confidenceNoteFor([0, 1, 2], [0, 1, 2]) ?? "",
      confidenceNoteFor([1, 2], []) ?? "",
    ];
    expect(strings.length).toBeGreaterThan(50);
    for (const text of strings) {
      expect(text).not.toMatch(/bot/i);
    }
  });

  it("never shows a percentage outside the reply share observation", () => {
    for (const text of allFixedStrings()) {
      expect(text).not.toContain("%");
    }
  });
});

describe("selectReasons", () => {
  const sorted: Evidence[] = [
    evidence("a", 2.0, "activity"),
    evidence("b", -1.5, "age"),
    evidence("c", 1.0, "graph"),
    evidence("d", 0.6, "handle"),
    evidence("e", 0.4, "profile"),
    evidence("f", 0.2, "content"),
  ];

  it("keeps at most four reasons with a contribution of at least 0.3 in magnitude", () => {
    expect(selectReasons(sorted)).toEqual(["reason:a", "reason:b", "reason:c", "reason:d"]);
  });

  it("includes negative evidence", () => {
    expect(selectReasons(sorted.slice(0, 2))).toEqual(["reason:a", "reason:b"]);
  });

  it("fills to two reasons from weaker evidence when fewer than two clear the bar", () => {
    expect(selectReasons([sorted[0]!, sorted[5]!])).toEqual(["reason:a", "reason:f"]);
    expect(selectReasons([evidence("x", 0.1, "geo"), evidence("y", 0, "geo")])).toEqual([
      "reason:x",
      "reason:y",
    ]);
  });

  it("skips evidence with nothing to say, also when filling in", () => {
    const silent: Evidence = { ...evidence("g", 0, "handle"), reason: NO_REASON };
    expect(selectReasons([sorted[0]!, silent, sorted[5]!])).toEqual(["reason:a", "reason:f"]);
    expect(selectReasons([silent])).toEqual([]);
  });

  it("returns what is available when there is less than two", () => {
    expect(selectReasons([sorted[0]!])).toEqual(["reason:a"]);
    expect(selectReasons([])).toEqual([]);
  });
});

describe("caveatFor", () => {
  const base = { tier: "some" as const, signals: signalsWith(), now: NOW, sourcesMissing: [] };

  it("picks the group caveat from the largest positive contribution", () => {
    const caveat: string = caveatFor({
      ...base,
      evidenceByMagnitude: [evidence("age", -1.5, "age"), evidence("graph", 1.0, "graph")],
    });
    expect(caveat).toBe(
      "People who follow widely before anyone follows back look the same. This is a pattern read, not a verdict. Humans trip these signals every day.",
    );
  });

  it("falls back to the strongest evidence when nothing is positive", () => {
    const caveat: string = caveatFor({
      ...base,
      evidenceByMagnitude: [evidence("age", -0.5, "age")],
    });
    expect(caveat).toMatch(/^Every account was new once/);
  });

  it("closes a Likely human card with the ordinary-account line instead of a suspicion caveat", () => {
    const caveat: string = caveatFor({
      ...base,
      tier: "typical",
      evidenceByMagnitude: [evidence("handle", 0.4, "handle"), evidence("age", -0.6, "age")],
    });
    expect(caveat).toBe("These signals look like an ordinary account; nothing here is proof.");
    expect(
      caveatFor({ ...base, tier: "typical", sourcesMissing: [2], evidenceByMagnitude: [] }),
    ).toBe(
      "These signals look like an ordinary account; nothing here is proof. Some signals could not be loaded, so this read is less certain.",
    );
  });

  it("closes with the missing-sources line when a source did not deliver", () => {
    const caveat: string = caveatFor({
      ...base,
      sourcesMissing: [2],
      evidenceByMagnitude: [evidence("activity", 2.0, "activity")],
    });
    expect(caveat).toBe(
      "High-volume human posters, news desks and brand accounts show the same pattern. Some signals could not be loaded, so this read is less certain.",
    );
  });

  it("prefers the long-lived line for accounts older than two years", () => {
    const caveat: string = caveatFor({
      ...base,
      signals: signalsWith({ values: { createdAt: MARCH_2019 } }),
      sourcesMissing: [2],
      evidenceByMagnitude: [evidence("handle", 0.7, "handle")],
    });
    expect(caveat).toMatch(/Long-lived accounts are rarely automated; weigh this lightly\.$/);
  });

  it("uses only the declared line for declared accounts", () => {
    const caveat: string = caveatFor({ ...base, tier: "declared", evidenceByMagnitude: [] });
    expect(caveat).toBe(
      "The account operator chose to label it as automated. That is the platform's recommended, transparent practice.",
    );
  });

  it("uses only the closing line when there is no evidence", () => {
    expect(caveatFor({ ...base, evidenceByMagnitude: [] })).toBe(
      "This is a pattern read, not a verdict. Humans trip these signals every day.",
    );
  });

  it("says there is too little to read for an unknown verdict", () => {
    expect(caveatFor({ ...base, tier: "unknown", evidenceByMagnitude: [] })).toBe(
      "Too little is visible about this account to read it either way.",
    );
  });
});

describe("confidenceNoteFor", () => {
  it("is absent when every expected source delivered", () => {
    expect(confidenceNoteFor([], [0, 1, 2])).toBeUndefined();
  });

  it("names a tier that has not loaded yet", () => {
    expect(confidenceNoteFor([1], [0, 1, 2])).toBe("Profile details not loaded yet");
    expect(confidenceNoteFor([2], [0, 1, 2])).toBe("Extra lookups not run yet");
  });

  it("names a tier that is switched off", () => {
    expect(confidenceNoteFor([2], [0, 1])).toBe("Extra lookups are off");
    expect(confidenceNoteFor([1, 2], [0])).toBe("Profile details are off. Extra lookups are off");
  });
});
