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

const relay = (op: string, body: unknown): void => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        __botdar: 1,
        v: 1,
        kind: X_GRAPHQL_RELAY_KIND,
        op,
        queryId: "QueryId_000000000001",
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
