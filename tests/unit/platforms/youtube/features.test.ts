import { readFileSync } from "node:fs";

import { scoreAccount } from "@/src/core/scoring/engine";
import { defaultWeights } from "@/src/core/scoring/weights";
import type { AccountSignals, Feature, PartialSignals, Verdict } from "@/src/core/types";
import { toFeatures } from "@/src/platforms/youtube/features";
import type { VideoCreator } from "@/src/platforms/youtube/handles";
import type { ChannelAboutParseResult } from "@/src/platforms/youtube/parsers/channelAbout";
import { parseChannelAbout } from "@/src/platforms/youtube/parsers/channelAbout";

const DAY_MILLIS = 86_400_000;
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const CREATOR: VideoCreator = { handles: new Set(["bbcnews"]), names: ["BBC News", "BBCNews"] };

function signalsFor(handle: string, partial: Partial<AccountSignals> = {}): AccountSignals {
  return {
    ref: { platform: "youtube", handle },
    provenance: {},
    tiersDelivered: [0],
    observedAt: NOW,
    ...partial,
  };
}

/** The recorded About browse as the resolver holds it after Tier 0 and Tier 2 delivered. */
function recordedSignals(): AccountSignals {
  const body: unknown = JSON.parse(
    readFileSync(
      new URL("../../../fixtures/youtube/innertube/browse-about.json", import.meta.url),
      "utf8",
    ),
  );
  const result: ChannelAboutParseResult = parseChannelAbout(body);
  if (result.status !== "ok") throw new Error("browse-about.json did not parse");
  return lookedUp("jonas_reads12", result.signals);
}

function lookedUp(handle: string, tier2: PartialSignals): AccountSignals {
  const provenance: AccountSignals["provenance"] = {};
  for (const field of Object.keys(tier2)) {
    provenance[field as keyof AccountSignals["provenance"]] = 2;
  }
  return signalsFor(handle, { ...tier2, provenance, tiersDelivered: [0, 2] });
}

const byId = (features: Feature[]): Record<string, Feature> =>
  Object.fromEntries(features.map((feature) => [feature.id, feature]));

function score(signals: AccountSignals, creator: VideoCreator | undefined = CREATOR): Verdict {
  return scoreAccount(toFeatures(signals, creator, NOW), signals, defaultWeights.youtube, {
    policyVersion: 1,
    now: NOW,
    sourcesAvailable: [0, 2],
  });
}

describe("youtube toFeatures", () => {
  it("reads only the handle before the lookup: an assigned one counts, a chosen one weighs nothing", () => {
    expect(toFeatures(signalsFor("larryh-h6q"), CREATOR, NOW)).toEqual([
      { id: "youtube.assignedHandle", value: true, group: "handle", tier: 0 },
    ]);
    expect(toFeatures(signalsFor("gecko_hiker"), CREATOR, NOW)).toEqual([
      { id: "youtube.assignedHandle", value: false, group: "handle", tier: 0 },
    ]);
  });

  it("reads the recorded channel's age, videos and empty description from Tier 2", () => {
    const features: Record<string, Feature> = byId(toFeatures(recordedSignals(), CREATOR, NOW));
    expect(features["youtube.channelAgeDays"]).toMatchObject({ group: "age", tier: 2 });
    expect(features["youtube.hasVideos"]).toEqual({
      id: "youtube.hasVideos",
      value: true,
      group: "profile",
      tier: 2,
    });
    expect(features["youtube.hasDescription"]?.value).toBe(false);
    expect(features["youtube.imitatesCreator"]).toBeUndefined();
  });

  it("finds a handle posing as the creator on the page, and a channel name once it is read", () => {
    expect(
      byId(toFeatures(signalsFor("bbcnews-x7k"), CREATOR, NOW))["youtube.imitatesCreator"],
    ).toEqual({
      id: "youtube.imitatesCreator",
      value: true,
      group: "handle",
      tier: 0,
      detail: "handle",
    });
    const named: AccountSignals = lookedUp("user-zk8ed4kd2b", { displayName: "BBC Nеws" });
    expect(byId(toFeatures(named, CREATOR, NOW))["youtube.imitatesCreator"]).toMatchObject({
      tier: 2,
      detail: "name",
    });
  });

  it("never scores the creator, by its handle or by the chip on its comment, nor without a creator", () => {
    const creatorAccount: AccountSignals = lookedUp("bbcnews", { displayName: "BBC News" });
    expect(
      byId(toFeatures(creatorAccount, CREATOR, NOW))["youtube.imitatesCreator"],
    ).toBeUndefined();
    const chipped: VideoCreator = { ...CREATOR, handles: new Set(["bbcnews", "bbc.news"]) };
    expect(
      byId(toFeatures(signalsFor("bbc.news"), chipped, NOW))["youtube.imitatesCreator"],
    ).toBeUndefined();
    expect(
      byId(toFeatures(signalsFor("bbc.news"), undefined, NOW))["youtube.imitatesCreator"],
    ).toBeUndefined();
  });
});

describe("youtube verdicts with the default weights", () => {
  it("reads the recorded commenter, twelve years old with four videos, as Likely human", () => {
    const verdict: Verdict = score(recordedSignals());
    expect(verdict.tier).toBe("typical");
    expect(verdict.reasons.map((reason) => [reason.text, reason.direction])).toEqual([
      ["Account is 13 years old", "ordinary"],
      ["Has 4 public videos", "ordinary"],
    ]);
  });

  it("gives an ordinary handle no read before the lookup", () => {
    expect(score(signalsFor("gecko_hiker")).tier).toBe("unknown");
  });

  it("calls a handle posing as the creator Unsure from the page alone, hollow until looked up", () => {
    const verdict: Verdict = score(signalsFor("bbcnews_official1"));
    expect(verdict.tier).toBe("some");
    expect(verdict.lowConfidence).toBe(true);
    expect(verdict.reasons[0]?.text).toBe("Handle imitates this video's creator");
    expect(verdict.caveat).toContain("Fan and tribute channels often use the creator's name too.");
  });

  it("calls a channel weeks old posing as the creator Likely bot", () => {
    const verdict: Verdict = score(
      lookedUp("bbcnews-x7k", { createdAt: NOW - 12 * DAY_MILLIS, postCount: 0, bio: "" }),
    );
    expect(verdict.tier).toBe("many");
    expect(verdict.reasons.map((reason) => reason.text).slice(0, 2)).toEqual([
      "Handle imitates this video's creator",
      "Joined 12 days ago",
    ]);
  });

  it("gives a new channel with an assigned handle no read: a join date alone decides nothing", () => {
    const verdict: Verdict = score(
      lookedUp("larryh-h6q", { createdAt: NOW - 20 * DAY_MILLIS, postCount: 0, bio: "" }),
    );
    expect(verdict.tier).toBe("unknown");
  });
});
