import { readFileSync } from "node:fs";

import { scoreAccount } from "@/src/core/scoring/engine";
import { defaultWeights } from "@/src/core/scoring/weights";
import type { AccountSignals, Feature, PartialSignals, Verdict } from "@/src/core/types";
import { toFeatures } from "@/src/platforms/hackernews/features";
import type { FirebaseUserParseResult } from "@/src/platforms/hackernews/parsers/user";
import { parseFirebaseUser } from "@/src/platforms/hackernews/parsers/user";

const DAY_MILLIS = 86_400_000;
/** The recordings were made on 2026-10-27; reading them a day later keeps the new account new. */
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

function signalsFor(partial: Partial<AccountSignals> = {}): AccountSignals {
  return {
    ref: { platform: "hackernews", handle: "someone" },
    provenance: {},
    tiersDelivered: [],
    observedAt: NOW,
    ...partial,
  };
}

/** The recorded Firebase body as the resolver holds it after Tier 0 and Tier 2 delivered. */
function recordedSignals(name: string): AccountSignals {
  const body: unknown = JSON.parse(
    readFileSync(new URL(`../../../fixtures/hackernews/firebase/${name}`, import.meta.url), "utf8"),
  );
  const result: FirebaseUserParseResult = parseFirebaseUser(body);
  if (result.status !== "ok") throw new Error(`${name} did not parse`);
  const tier2: PartialSignals = result.signals;
  const provenance: AccountSignals["provenance"] = { displayName: 0 };
  for (const field of Object.keys(tier2)) {
    provenance[field as keyof AccountSignals["provenance"]] = 2;
  }
  return signalsFor({
    ...tier2,
    ref: { platform: "hackernews", handle: result.id },
    displayName: result.id,
    provenance,
    tiersDelivered: [0, 2],
  });
}

const ids = (features: Feature[]): string[] => features.map((feature) => feature.id);

function score(signals: AccountSignals): Verdict {
  return scoreAccount(toFeatures(signals, NOW), signals, defaultWeights.hackernews, {
    policyVersion: 1,
    now: NOW,
    sourcesAvailable: [0, 1, 2],
  });
}

describe("hackernews toFeatures", () => {
  it("emits nothing for an account the lookup has not reached: the page shows only a name", () => {
    expect(
      toFeatures(signalsFor({ displayName: "someone", provenance: { displayName: 0 } }), NOW),
    ).toEqual([]);
  });

  it("emits every feature for a looked-up young, busy account, each from Tier 2", () => {
    const features: Feature[] = toFeatures(
      signalsFor({
        createdAt: NOW - 20 * DAY_MILLIS,
        karma: 4_000,
        postCount: 900,
        bio: "",
        provenance: { createdAt: 2, karma: 2, postCount: 2, bio: 2 },
      }),
      NOW,
    );
    expect(features).toEqual([
      { id: "hn.accountAgeDays", value: 20, group: "age", tier: 2 },
      { id: "hn.karmaPerDay", value: 200, group: "activity", tier: 2 },
      { id: "hn.submissionsPerDay", value: 45, group: "activity", tier: 2 },
      { id: "hn.hasAbout", value: false, group: "profile", tier: 2 },
    ]);
  });

  it("gates the karma rate to young accounts and the submission rate to ten or more", () => {
    const old: Feature[] = toFeatures(
      signalsFor({ createdAt: NOW - 400 * DAY_MILLIS, karma: 90_000, postCount: 9, bio: "Hi" }),
      NOW,
    );
    expect(ids(old)).toEqual(["hn.accountAgeDays", "hn.hasAbout"]);
  });

  it("divides by at least one day and treats negative karma as none", () => {
    const features: Feature[] = toFeatures(
      signalsFor({ createdAt: NOW - DAY_MILLIS / 4, karma: -4, postCount: 12 }),
      NOW,
    );
    expect(features.find((feature) => feature.id === "hn.karmaPerDay")?.value).toBe(0);
    expect(features.find((feature) => feature.id === "hn.submissionsPerDay")?.value).toBe(12);
  });
});

describe("scoring the recorded Hacker News accounts with the default weights", () => {
  it("reads the established account with an about text as Likely human, with its reasons", () => {
    const verdict: Verdict = score(recordedSignals("user.json"));
    expect(verdict.tier).toBe("typical");
    // The submission count weighs nothing, so two material reasons leave it off the card.
    expect(verdict.reasons.map((reason) => [reason.text, reason.direction])).toEqual([
      ["Account is 14 years old", "ordinary"],
      ["Has an about section", "ordinary"],
    ]);
    expect(verdict.evidence.map((item) => item.reason)).toContain(
      "147 posts and comments in 14 years",
    );
    expect(verdict.caveat).toBe("An aged account can be bought and repurposed.");
  });

  it("gives the day-old account no read rather than a verdict either way", () => {
    const verdict: Verdict = score(recordedSignals("user-new.json"));
    expect(verdict.tier).toBe("unknown");
  });

  it("keeps a young, very busy account to Unsure without a second strong group", () => {
    const verdict: Verdict = score(
      signalsFor({
        createdAt: NOW - 10 * DAY_MILLIS,
        karma: 40,
        postCount: 600,
        bio: "",
        provenance: { createdAt: 2, karma: 2, postCount: 2, bio: 2 },
        tiersDelivered: [0, 2],
      }),
    );
    expect(verdict.tier).toBe("some");
    expect(verdict.reasons[0]?.text).toBe("Joined 10 days ago");
    expect(verdict.reasons[1]?.text).toBe("600 posts and comments in 10 days");
  });

  it("returns the declared tier for an about text that says it is a bot", () => {
    const verdict: Verdict = score(
      signalsFor({
        bio: "I am a bot that posts release notes.",
        declaredAutomated: true,
        declaredBy: "bio",
        provenance: { bio: 2, declaredAutomated: 2, declaredBy: 2 },
        tiersDelivered: [2],
      }),
    );
    expect(verdict.tier).toBe("declared");
    expect(verdict.reasons[0]?.text).toBe("Its bio describes the account as automated");
  });
});
