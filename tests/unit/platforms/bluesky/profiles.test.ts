import { readFileSync } from "node:fs";

import {
  parseFeedAuthors,
  parseProfiles,
  type ParsedBlueskyProfile,
} from "../../../../src/platforms/bluesky/parsers/profiles";

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/bluesky/${name}`, import.meta.url), "utf8"),
  );
}

function profileByHandle(profiles: ParsedBlueskyProfile[], handle: string): ParsedBlueskyProfile {
  const profile: ParsedBlueskyProfile | undefined = profiles.find(
    (candidate) => candidate.ref.handle === handle,
  );
  if (profile === undefined) {
    throw new Error(`no profile ${handle}`);
  }
  return profile;
}

function handles(profiles: ParsedBlueskyProfile[]): string[] {
  return profiles.map((profile) => profile.ref.handle);
}

describe("parseProfiles on getProfiles", () => {
  const profiles: ParsedBlueskyProfile[] = parseProfiles(loadFixture("get-profiles.json"));

  it("returns one entry per profile with the DID as id", () => {
    expect(profiles.map((profile) => profile.ref)).toEqual([
      { platform: "bluesky", handle: "example.social", id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" },
      { platform: "bluesky", handle: "alice.example.com", id: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb" },
      {
        platform: "bluesky",
        handle: "kai09127364.bsky.social",
        id: "did:plc:cccccccccccccccccccccccc",
      },
      {
        platform: "bluesky",
        handle: "mila48213907.bsky.social",
        id: "did:plc:eeeeeeeeeeeeeeeeeeeeeeee",
      },
    ]);
  });

  it("maps a full profile field by field", () => {
    expect(profileByHandle(profiles, "alice.example.com").signals).toEqual({
      createdAt: Date.parse("2023-04-14T18:12:06.575Z"),
      followers: 15200,
      following: 870,
      postCount: 31000,
      displayName: "Alice Example",
      bio: "Writes about compilers and gardens. she/her",
      hasDefaultAvatar: false,
      verified: "blue",
      declaredAutomated: false,
    });
  });

  it("treats verifiedStatus none as not verified", () => {
    const signals = profileByHandle(profiles, "example.social").signals;
    expect(signals.verified).toBe("none");
    expect(signals.followers).toBe(35338336);
    expect(signals.following).toBe(23);
    expect(signals.postCount).toBe(886);
  });

  it("maps a self-labelled bot with no avatar, no display name and an empty bio", () => {
    expect(profileByHandle(profiles, "kai09127364.bsky.social").signals).toEqual({
      createdAt: Date.parse("2026-10-01T09:12:45.000Z"),
      followers: 12,
      following: 2400,
      postCount: 8900,
      bio: "",
      hasDefaultAvatar: true,
      verified: "none",
      declaredAutomated: true,
    });
  });

  it("accepts a single getProfile body", () => {
    const body = loadFixture("get-profiles.json") as { profiles: unknown[] };
    expect(handles(parseProfiles(body.profiles[1]))).toEqual(["alice.example.com"]);
  });

  it.each([null, undefined, 1, "profiles", [], {}, { profiles: null }, { profiles: {} }])(
    "returns an empty list for %p",
    (body) => {
      expect(parseProfiles(body)).toEqual([]);
    },
  );
});

describe("parseFeedAuthors", () => {
  it("collects the author and the reposter from getAuthorFeed", () => {
    const profiles: ParsedBlueskyProfile[] = parseFeedAuthors(loadFixture("get-author-feed.json"));
    expect(handles(profiles)).toEqual(["alice.example.com", "example.social"]);
    expect(profileByHandle(profiles, "alice.example.com").signals).toEqual({
      createdAt: Date.parse("2023-04-14T18:12:06.575Z"),
      displayName: "Alice Example",
      hasDefaultAvatar: false,
      verified: "blue",
      declaredAutomated: false,
    });
    expect(profileByHandle(profiles, "example.social").ref.id).toBe(
      "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("collects post, quoted-record and reply-chain authors from getTimeline, once each", () => {
    const profiles: ParsedBlueskyProfile[] = parseFeedAuthors(loadFixture("get-timeline.json"));
    expect(handles(profiles)).toEqual([
      "kai09127364.bsky.social",
      "alice.example.com",
      "newsroom.example.org",
      "mila48213907.bsky.social",
    ]);
    expect(profileByHandle(profiles, "kai09127364.bsky.social").signals).toEqual({
      createdAt: Date.parse("2026-10-01T09:12:45.000Z"),
      hasDefaultAvatar: true,
      verified: "none",
      declaredAutomated: true,
    });
  });

  it("does not treat a bot label from a third-party labeler as a self-label", () => {
    const profiles: ParsedBlueskyProfile[] = parseFeedAuthors(loadFixture("get-timeline.json"));
    const signals = profileByHandle(profiles, "newsroom.example.org").signals;
    expect(signals.declaredAutomated).toBe(false);
    expect(signals.verified).toBe("none");
  });

  it("walks nested thread replies and skips blocked and not-found posts", () => {
    const profiles: ParsedBlueskyProfile[] = parseFeedAuthors(loadFixture("get-post-thread.json"));
    expect(handles(profiles)).toEqual([
      "alice.example.com",
      "newsroom.example.org",
      "sam2026.bsky.social",
    ]);
    expect(profileByHandle(profiles, "sam2026.bsky.social").signals).toEqual({
      createdAt: Date.parse("2026-10-20T22:15:09.000Z"),
      displayName: "",
      hasDefaultAvatar: true,
      verified: "none",
      declaredAutomated: false,
    });
    const newsroom = profileByHandle(profiles, "newsroom.example.org").signals;
    expect(newsroom.verified).toBeUndefined();
    expect(newsroom.declaredAutomated).toBe(false);
  });

  it("terminates on cyclic input", () => {
    const author: Record<string, unknown> = { did: "did:plc:loop", handle: "loop.example" };
    const wrapper: Record<string, unknown> = { feed: [{ post: { author } }] };
    author.parent = wrapper;
    wrapper.self = wrapper;
    expect(handles(parseFeedAuthors(wrapper))).toEqual(["loop.example"]);
  });

  it("stops at 500 authors per response", () => {
    const feed = Array.from({ length: 600 }, (_, index) => ({
      post: { author: { did: `did:plc:${index}`, handle: `user${index}.example` } },
    }));
    expect(parseFeedAuthors({ feed })).toHaveLength(500);
  });

  it("stops walking after 200k nodes", () => {
    const filler = Array.from({ length: 200_000 }, () => ({}));
    const body = { filler, late: { did: "did:plc:late", handle: "late.example" } };
    expect(parseFeedAuthors(body)).toEqual([]);
  });

  it.each([null, undefined, 7, '{"feed":', [], {}, { feed: null }])(
    "returns an empty list for %p",
    (body) => {
      expect(parseFeedAuthors(body)).toEqual([]);
    },
  );
});

describe("parseProfiles on mangled input", () => {
  const profiles: ParsedBlueskyProfile[] = parseProfiles(loadFixture("mangled.json"));

  it("keeps only entries with a DID and a usable handle", () => {
    expect(handles(profiles)).toEqual(["odd.types.example", "mixed.case.example"]);
  });

  it("leaves every oddly typed field unobserved, reads a blank avatar as missing and caps the bio", () => {
    expect(profileByHandle(profiles, "odd.types.example").signals).toEqual({
      bio: "x".repeat(500),
      hasDefaultAvatar: true,
    });
  });

  it("trims and lowercases the handle and ignores malformed labels", () => {
    expect(profileByHandle(profiles, "mixed.case.example").signals).toEqual({
      hasDefaultAvatar: true,
      verified: "none",
      declaredAutomated: true,
    });
  });
});
