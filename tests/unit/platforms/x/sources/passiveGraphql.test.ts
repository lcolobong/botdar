// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountRef, PartialSignals, SignalSource } from "@/src/core/types";
import { X_GRAPHQL_RELAY_KIND } from "@/src/platforms/x/graphqlRoutes";
import {
  PASSIVE_GRAPHQL_SOURCE_ID,
  createPassiveGraphqlSource,
} from "@/src/platforms/x/sources/passiveGraphql";

/** happy-dom rebinds URL to the page origin, so fixtures are located from the project root. */
function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/x/graphql", name), "utf8"));
}

const relay = (op: string, body: unknown, query?: string): void => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        __botdar: 1,
        v: 1,
        kind: X_GRAPHQL_RELAY_KIND,
        op,
        queryId: "QueryId_000000000001",
        ...(query === undefined ? {} : { query }),
        body,
      },
      origin: location.origin,
      source: window,
    }),
  );
};

type Emission = [AccountRef, PartialSignals];

function start(): { emissions: Emission[]; stop: () => void; source: SignalSource } {
  const emissions: Emission[] = [];
  const source: SignalSource = createPassiveGraphqlSource();
  if (source.start === undefined) throw new Error("passive source has no start");
  const stop: () => void = source.start((ref, partial) => emissions.push([ref, partial]));
  return { emissions, stop, source };
}

describe("createPassiveGraphqlSource", () => {
  it("declares itself as the passive Tier 1 source for x", () => {
    const { source, stop } = start();
    expect(source).toMatchObject({
      id: PASSIVE_GRAPHQL_SOURCE_ID,
      platform: "x",
      tier: 1,
      kind: "passive",
    });
    stop();
  });

  it("emits one signal set per user found in a timeline body", () => {
    const { emissions, stop } = start();
    relay("HomeTimeline", loadFixture("home-timeline-core.json"));
    stop();
    expect(emissions.map(([ref]) => ref.handle)).toEqual([
      "alice_example",
      "example_news",
      "kai09127364",
      "maria_dev",
      "mila48213907",
    ]);
    const [aliceRef, aliceSignals] = emissions[0] ?? [];
    expect(aliceRef).toEqual({ platform: "x", handle: "alice_example", id: "1000000000000000001" });
    expect(aliceSignals).toMatchObject({ followers: 340, following: 210, postCount: 4100 });
  });

  it("adds each author's post text to the signals it emits for them", () => {
    const { emissions, stop } = start();
    relay("HomeTimeline", loadFixture("home-timeline-core.json"));
    stop();
    const postTexts: Record<string, string | undefined> = Object.fromEntries(
      emissions.map(([ref, signals]) => [ref.handle, signals.postText]),
    );
    expect(postTexts).toEqual({
      alice_example: "This is worth a read.\nRepeated author, same rest_id.",
      example_news: "Our live coverage starts now.",
      kai09127364: "Agreed 💯",
      maria_dev: undefined,
      mila48213907: "Follow for daily picks 🔥",
    });
  });

  const userTweets = (): unknown =>
    JSON.parse(
      readFileSync(join(process.cwd(), "tests/fixtures/smoke/x-user-tweets.json"), "utf8"),
    );
  const variablesFor = (userId: string): string =>
    `?${new URLSearchParams({ variables: JSON.stringify({ userId, count: 20 }) })}`;

  it("emits the owner's post times from the posts tab, and from no other operation", () => {
    const { emissions, stop } = start();
    relay("UserTweets", userTweets());
    relay("UserTweetsAndReplies", userTweets());
    relay("HomeTimeline", userTweets());
    stop();
    const [fromProfile, fromReplies, fromFeed] = emissions.filter(
      ([ref]) => ref.handle === "maria_dev",
    );
    expect(fromProfile?.[1].postTimestamps).toHaveLength(100);
    expect(fromReplies?.[1]).not.toHaveProperty("postTimestamps");
    expect(fromFeed?.[1]).not.toHaveProperty("postTimestamps");
    expect(fromFeed?.[1].postText).toBe(fromProfile?.[1].postText);
  });

  it("takes the owner from the request's variables when the relay carries them", () => {
    const { emissions, stop } = start();
    relay("UserTweets", userTweets(), variablesFor("1000000000000000004"));
    relay("UserTweets", userTweets(), variablesFor("1000000000000000999"));
    stop();
    const [named, otherUser] = emissions.filter(([ref]) => ref.handle === "maria_dev");
    expect(named?.[1].postTimestamps).toHaveLength(100);
    expect(otherUser?.[1]).not.toHaveProperty("postTimestamps");
  });

  const OWNER_ID = "1000000000000000007";
  const repliesTabPage = (from: number, to: number): unknown => {
    const body = loadFixture("user-tweets-and-replies.json") as {
      data: {
        user: { result: { timeline: { timeline: { instructions: [{ entries: unknown[] }] } } } };
      };
    };
    const [instruction] = body.data.user.result.timeline.timeline.instructions;
    return {
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [{ entries: (instruction?.entries ?? []).slice(from, to) }],
              },
            },
          },
        },
      },
    };
  };
  const replyShares = (emissions: Emission[]): unknown[] =>
    emissions
      .filter(([ref]) => ref.handle === "reply_guy_01")
      .map(([, signals]) => signals.replyShare);

  it("emits the reply share of the replies tab's owner, and from no other operation", () => {
    const { emissions, stop } = start();
    const repliesTab: unknown = loadFixture("user-tweets-and-replies.json");
    relay("UserTweetsAndReplies", repliesTab, variablesFor(OWNER_ID));
    relay("UserTweetsAndReplies", repliesTab, variablesFor("1000000000000000999"));
    relay("UserTweetsAndReplies", repliesTab);
    relay("UserTweets", repliesTab, variablesFor(OWNER_ID));
    relay("HomeTimeline", repliesTab);
    stop();
    expect(replyShares(emissions)).toEqual([
      { ratio: 20 / 24, sampleSize: 24 },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("accumulates the pages of a replies tab by tweet id, so overlap and re-fetches add nothing", () => {
    const { emissions, stop } = start();
    relay("UserTweetsAndReplies", repliesTabPage(0, 12), variablesFor(OWNER_ID));
    relay("UserTweetsAndReplies", repliesTabPage(0, 12), variablesFor(OWNER_ID));
    relay("UserTweetsAndReplies", repliesTabPage(8, 24), variablesFor(OWNER_ID));
    relay("UserTweetsAndReplies", repliesTabPage(20, 24), variablesFor(OWNER_ID));
    stop();
    expect(replyShares(emissions)).toEqual([
      { ratio: 1, sampleSize: 12 },
      { ratio: 1, sampleSize: 12 },
      { ratio: 20 / 24, sampleSize: 24 },
      { ratio: 20 / 24, sampleSize: 24 },
    ]);
  });

  it("emits the user and the About projection for an AboutAccountQuery body", () => {
    const { emissions, stop } = start();
    relay("AboutAccountQuery", loadFixture("about-account.json"));
    stop();
    expect(emissions).toHaveLength(2);
    const [, about] = emissions;
    expect(about?.[0]).toEqual({ platform: "x", handle: "kai09127364" });
    expect(about?.[1]).toEqual({
      country: "United States",
      usernameChanges: 3,
      appStore: "App Store",
    });
  });

  it("never emits declaredAutomated from relayed bodies, even when the user object carries it", () => {
    const { emissions, stop } = start();
    relay("HomeTimeline", loadFixture("home-timeline-core.json"));
    relay("AboutAccountQuery", loadFixture("about-account.json"));
    stop();
    expect(emissions.length).toBeGreaterThan(0);
    for (const [, signals] of emissions) {
      expect(signals).not.toHaveProperty("declaredAutomated");
    }
  });

  it("does not project About fields from other operations, and survives a mangled body", () => {
    const { emissions, stop } = start();
    relay("UserByScreenName", loadFixture("about-account.json"));
    const afterAbout: number = emissions.length;
    relay("TweetDetail", loadFixture("mangled.json"));
    relay("TweetDetail", "not an object");
    relay("TweetDetail", null);
    stop();
    expect(afterAbout).toBe(1);
    for (const [ref] of emissions) {
      expect(ref.platform).toBe("x");
    }
  });

  it("stops emitting after unsubscribe", () => {
    const { emissions, stop } = start();
    stop();
    relay("HomeTimeline", loadFixture("home-timeline-core.json"));
    expect(emissions).toHaveLength(0);
  });
});
