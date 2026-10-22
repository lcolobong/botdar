// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://bsky.app/"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountRef, PartialSignals, SignalSource } from "@/src/core/types";
import { createPassiveXrpcSource } from "@/src/platforms/bluesky/sources/passiveXrpc";

// happy-dom replaces URL with the page's, so fixtures resolve from the directory, not import.meta.url.
function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "..", "fixtures", "bluesky", name), "utf8"),
  );
}

const dispatchEnvelope = (op: string | undefined, body: unknown): void => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { __botdar: 1, v: 1, kind: "bsky.xrpc", ...(op === undefined ? {} : { op }), body },
      origin: location.origin,
      source: window,
    }),
  );
};

describe("passive XRPC source", () => {
  let stop: () => void = () => undefined;
  let emitted: Array<{ ref: AccountRef; partial: PartialSignals }> = [];

  beforeEach(() => {
    emitted = [];
    const source: SignalSource = createPassiveXrpcSource();
    expect(source).toMatchObject({
      id: "bluesky.xrpc",
      platform: "bluesky",
      tier: 1,
      kind: "passive",
    });
    stop = source.start?.((ref, partial) => emitted.push({ ref, partial })) ?? stop;
  });

  afterEach(() => {
    stop();
  });

  it("emits one partial per author in a timeline body", () => {
    dispatchEnvelope("app.bsky.feed.getTimeline", loadFixture("get-timeline.json"));

    expect(emitted.map((entry) => entry.ref.handle)).toEqual([
      "kai09127364.bsky.social",
      "alice.example.com",
      "newsroom.example.org",
      "mila48213907.bsky.social",
    ]);
    const declared = emitted.find((entry) => entry.ref.handle === "kai09127364.bsky.social");
    expect(declared?.ref.id).toBe("did:plc:cccccccccccccccccccccccc");
    expect(declared?.partial.createdAt).toBe(Date.parse("2026-10-01T09:12:45.000Z"));
    expect(declared?.partial.followers).toBeUndefined();
  });

  it("never emits declaredAutomated, even for an author whose relayed labels declare a bot", () => {
    dispatchEnvelope("app.bsky.feed.getTimeline", loadFixture("get-timeline.json"));
    dispatchEnvelope("app.bsky.actor.getProfiles", loadFixture("get-profiles.json"));

    expect(emitted.map((entry) => entry.ref.handle)).toContain("kai09127364.bsky.social");
    for (const entry of emitted) {
      expect(entry.partial).not.toHaveProperty("declaredAutomated");
    }
  });

  it.each([
    ["app.bsky.feed.getFeed", "get-timeline.json"],
    ["app.bsky.feed.getAuthorFeed", "get-author-feed.json"],
    ["app.bsky.feed.getPostThread", "get-post-thread.json"],
  ])("walks %s bodies for authors", (op, fixture) => {
    dispatchEnvelope(op, loadFixture(fixture));
    expect(emitted.length).toBeGreaterThan(0);
  });

  it("reads getProfiles bodies with their counts", () => {
    dispatchEnvelope("app.bsky.actor.getProfiles", loadFixture("get-profiles.json"));

    const alice = emitted.find((entry) => entry.ref.handle === "alice.example.com");
    expect(emitted).toHaveLength(4);
    expect(alice?.partial).toMatchObject({ followers: 15200, following: 870, postCount: 31000 });
  });

  it("reads a single getProfile body", () => {
    dispatchEnvelope("app.bsky.actor.getProfile", {
      did: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb",
      handle: "Alice.Example.com",
      followersCount: 5,
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.ref).toEqual({
      platform: "bluesky",
      handle: "alice.example.com",
      id: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb",
    });
  });

  it("ignores unknown or missing operations and mangled bodies", () => {
    dispatchEnvelope("app.bsky.notification.listNotifications", loadFixture("get-timeline.json"));
    dispatchEnvelope(undefined, loadFixture("get-timeline.json"));
    dispatchEnvelope("app.bsky.feed.getTimeline", "not an object");
    dispatchEnvelope("app.bsky.feed.getTimeline", null);

    expect(emitted).toHaveLength(0);
    expect(() =>
      dispatchEnvelope("app.bsky.feed.getTimeline", loadFixture("mangled.json")),
    ).not.toThrow();
  });

  it("stops emitting after the unsubscribe", () => {
    stop();
    dispatchEnvelope("app.bsky.feed.getTimeline", loadFixture("get-timeline.json"));
    expect(emitted).toHaveLength(0);
  });
});
