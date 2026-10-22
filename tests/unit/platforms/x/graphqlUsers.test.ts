import { readFileSync } from "node:fs";

import {
  collectUsers,
  parseAboutAccount,
  parseXTimestamp,
  toSignals,
  type ParsedXUser,
} from "../../../../src/platforms/x/parsers/graphqlUsers";

function loadFixture(name: string): unknown {
  const url = new URL(`../../../fixtures/x/graphql/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

function userByHandle(users: ParsedXUser[], handle: string): ParsedXUser {
  const user: ParsedXUser | undefined = users.find((candidate) => candidate.ref.handle === handle);
  if (user === undefined) {
    throw new Error(`no user ${handle}`);
  }
  return user;
}

describe("parseXTimestamp", () => {
  it("parses X's weekday-first format as UTC", () => {
    expect(parseXTimestamp("Wed Oct 10 20:19:24 +0000 2018")).toBe(
      Date.UTC(2018, 9, 10, 20, 19, 24),
    );
  });

  it("honours a non-zero offset", () => {
    expect(parseXTimestamp("Wed Oct 10 20:19:24 +0200 2018")).toBe(
      Date.UTC(2018, 9, 10, 18, 19, 24),
    );
    expect(parseXTimestamp("Wed Oct 10 20:19:24 -0530 2018")).toBe(
      Date.UTC(2018, 9, 11, 1, 49, 24),
    );
  });

  it("accepts ISO timestamps and rejects anything else", () => {
    expect(parseXTimestamp("2021-05-06T07:08:09.000Z")).toBe(Date.UTC(2021, 4, 6, 7, 8, 9));
    expect(parseXTimestamp("yesterday")).toBeUndefined();
    expect(parseXTimestamp("Wed Xyz 10 20:19:24 +0000 2018")).toBeUndefined();
    expect(parseXTimestamp(undefined)).toBeUndefined();
  });
});

describe("collectUsers on HomeTimeline (core shape)", () => {
  const users: ParsedXUser[] = collectUsers(loadFixture("home-timeline-core.json"));

  it("finds every distinct author in document order, including quoted and module users", () => {
    expect(users.map((user) => user.ref.handle)).toEqual([
      "alice_example",
      "example_news",
      "kai09127364",
      "maria_dev",
    ]);
    expect(users.map((user) => user.ref)).toEqual([
      { platform: "x", handle: "alice_example", id: "1000000000000000001" },
      { platform: "x", handle: "example_news", id: "1000000000000000002" },
      { platform: "x", handle: "kai09127364", id: "1000000000000000003" },
      { platform: "x", handle: "maria_dev", id: "1000000000000000004" },
    ]);
  });

  it("maps an ordinary account field by field", () => {
    expect(toSignals(userByHandle(users, "alice_example"))).toEqual({
      createdAt: Date.UTC(2018, 9, 10, 20, 19, 24),
      followers: 340,
      following: 210,
      postCount: 4100,
      displayName: "Alice Example",
      bio: "Reads more than she writes. Opinions are my own.",
      hasDefaultAvatar: false,
      verified: "none",
      declaredAutomated: false,
    });
  });

  it("maps a business-verified account to org", () => {
    const signals = toSignals(userByHandle(users, "example_news"));
    expect(signals.verified).toBe("org");
    expect(signals.followers).toBe(2500000);
    expect(signals.following).toBe(1200);
    expect(signals.postCount).toBe(980000);
    expect(signals.createdAt).toBe(Date.UTC(2006, 2, 21, 14, 2, 11));
  });

  it("maps a new blue account with a default avatar and empty bio", () => {
    expect(toSignals(userByHandle(users, "kai09127364"))).toEqual({
      createdAt: Date.UTC(2026, 0, 3, 9, 12, 45),
      followers: 12,
      following: 2400,
      postCount: 8900,
      displayName: "Kai",
      bio: "",
      hasDefaultAvatar: true,
      verified: "blue",
      declaredAutomated: false,
    });
  });

  it("maps a who-to-follow module user", () => {
    const signals = toSignals(userByHandle(users, "maria_dev"));
    expect(signals.displayName).toBe("Maria Dev");
    expect(signals.followers).toBe(15200);
    expect(signals.following).toBe(870);
    expect(signals.postCount).toBe(31000);
    expect(signals.hasDefaultAvatar).toBe(false);
  });
});

describe("collectUsers on TweetDetail (legacy shape)", () => {
  const users: ParsedXUser[] = collectUsers(loadFixture("tweet-detail-legacy.json"));

  it("skips tombstones and UserUnavailable results", () => {
    expect(users.map((user) => user.ref.handle)).toEqual([
      "legacy_poster",
      "helper_sum_7781",
      "sam_k_2025",
    ]);
  });

  it("maps the legacy fields", () => {
    expect(toSignals(userByHandle(users, "legacy_poster"))).toEqual({
      createdAt: Date.UTC(2015, 2, 2, 11, 5, 0),
      followers: 1520,
      following: 300,
      postCount: 25600,
      displayName: "Legacy Poster",
      bio: "Old-shape bio, still served on thread pages.",
      hasDefaultAvatar: false,
      verified: "none",
      declaredAutomated: false,
    });
  });

  it("reads the Automated affiliates label", () => {
    const signals = toSignals(userByHandle(users, "helper_sum_7781"));
    expect(signals.declaredAutomated).toBe(true);
    expect(signals.followers).toBe(86);
    expect(signals.following).toBe(1);
  });

  it("reads default_profile_image, the default avatar URL and legacy verified_type", () => {
    const signals = toSignals(userByHandle(users, "sam_k_2025"));
    expect(signals.hasDefaultAvatar).toBe(true);
    expect(signals.bio).toBe("");
    expect(signals.verified).toBe("gov");
    expect(signals.createdAt).toBe(Date.UTC(2025, 8, 28, 3, 14, 59));
  });

  it("reads legacy.automated when present", () => {
    const user: ParsedXUser = userByHandle(users, "legacy_poster");
    const legacy: Record<string, unknown> = { ...(user.node.legacy as object), automated: true };
    expect(toSignals({ ...user, node: { ...user.node, legacy } }).declaredAutomated).toBe(true);
  });
});

describe("collectUsers on UserByScreenName", () => {
  const users: ParsedXUser[] = collectUsers(loadFixture("user-by-screen-name.json"));

  it("prefers the core shape over the legacy fallbacks when both are present", () => {
    expect(users).toHaveLength(1);
    expect(toSignals(userByHandle(users, "alice_example"))).toEqual({
      createdAt: Date.UTC(2018, 9, 10, 20, 19, 24),
      followers: 341,
      following: 211,
      postCount: 4101,
      displayName: "Alice Example",
      bio: "Reads more than she writes. Opinions are my own.",
      hasDefaultAvatar: false,
      verified: "none",
      declaredAutomated: false,
    });
  });
});

describe("parseAboutAccount", () => {
  it("projects the About dialog fields", () => {
    expect(parseAboutAccount(loadFixture("about-account.json"))).toEqual({
      handle: "kai09127364",
      country: "United States",
      usernameChanges: 3,
      appStore: "App Store",
      declaredAutomated: false,
    });
  });

  it("accepts a username-change count serialised as a string and drops blank fields", () => {
    const body = {
      data: {
        user_result_by_screen_name: {
          result: {
            rest_id: "1",
            core: { screen_name: "Someone" },
            about_profile: { account_based_in: "  ", source: "", username_changes: { count: "7" } },
          },
        },
      },
    };
    expect(parseAboutAccount(body)).toEqual({ handle: "someone", usernameChanges: 7 });
  });

  it("returns null for anything that is not an About response", () => {
    expect(parseAboutAccount(loadFixture("home-timeline-core.json"))).toBeNull();
    expect(parseAboutAccount(loadFixture("mangled.json"))).toBeNull();
    expect(parseAboutAccount(null)).toBeNull();
    expect(parseAboutAccount('{"data":')).toBeNull();
    expect(parseAboutAccount({ data: { user_result_by_screen_name: { result: {} } } })).toBeNull();
  });
});

describe("collectUsers on mangled input", () => {
  const users: ParsedXUser[] = collectUsers(loadFixture("mangled.json"));

  it("keeps only objects with a string rest_id and a plausible screen name", () => {
    expect(users.map((user) => user.ref.handle)).toEqual([
      "odd_types",
      "legacy_fallback",
      "deeply_nested",
    ]);
  });

  it("leaves every oddly typed field unobserved and caps the bio", () => {
    const signals = toSignals(userByHandle(users, "odd_types"));
    expect(signals).toEqual({ bio: "x".repeat(500), declaredAutomated: false });
  });

  it("falls back to legacy fields and rejects unsafe or non-boolean values", () => {
    expect(toSignals(userByHandle(users, "legacy_fallback"))).toEqual({
      createdAt: Date.UTC(2021, 4, 6, 7, 8, 9),
      following: 10,
      postCount: 20,
      displayName: "Fallback",
      bio: "short",
    });
  });

  it("yields no signals for a bare user object", () => {
    expect(toSignals(userByHandle(users, "deeply_nested"))).toEqual({});
  });

  it.each([null, undefined, 42, '{"data":{"home"', [], {}, { data: null }])(
    "returns an empty list for %p",
    (body) => {
      expect(collectUsers(body)).toEqual([]);
    },
  );

  it("terminates on cyclic input", () => {
    const cyclic: Record<string, unknown> = { rest_id: "1", core: { screen_name: "loop" } };
    const wrapper: Record<string, unknown> = { child: cyclic };
    cyclic.parent = wrapper;
    wrapper.self = wrapper;
    expect(collectUsers(wrapper).map((user) => user.ref.handle)).toEqual(["loop"]);
  });

  it("stops at 500 users per response", () => {
    const entries = Array.from({ length: 600 }, (_, index) => ({
      rest_id: String(index),
      core: { screen_name: `user${index}` },
    }));
    expect(collectUsers({ entries })).toHaveLength(500);
  });

  it("stops walking after 200k nodes", () => {
    const filler = Array.from({ length: 200_000 }, () => ({}));
    const body = { filler, late: { rest_id: "9", core: { screen_name: "too_late" } } };
    expect(collectUsers(body)).toEqual([]);
  });
});
