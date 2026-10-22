import { readFileSync } from "node:fs";

import { parseAbout, parseAboutResponse } from "../../../../src/platforms/reddit/parsers/about";

function loadFixtureText(name: string): string {
  return readFileSync(new URL(`../../../fixtures/reddit/about/${name}`, import.meta.url), "utf8");
}

function loadFixture(name: string): unknown {
  return JSON.parse(loadFixtureText(name));
}

function normalWith(overrides: Record<string, unknown>): unknown {
  const body = loadFixture("normal.json") as { kind: string; data: Record<string, unknown> };
  return { ...body, data: { ...body.data, ...overrides } };
}

describe("parseAbout on a normal account", () => {
  it("maps every field", () => {
    expect(parseAbout(loadFixture("normal.json"))).toEqual({
      createdAt: 1573498800000,
      linkKarma: 1840,
      commentKarma: 22200,
      displayName: "Quiet Lantern",
      bio: "Lurker turned occasional poster. Mostly here for the woodworking threads.",
      hasDefaultAvatar: false,
      hasVerifiedEmail: true,
    });
  });

  it("lowercases the handle and reports the ok status", () => {
    expect(parseAboutResponse(loadFixture("normal.json"))).toMatchObject({
      status: "ok",
      handle: "quiet_lantern_4821",
    });
  });

  it("converts fractional created_utc seconds to whole milliseconds", () => {
    expect(parseAbout(normalWith({ created_utc: 1573498800.123 }))?.createdAt).toBe(1573498800123);
  });

  it("keeps negative karma", () => {
    expect(parseAbout(normalWith({ comment_karma: -100 }))?.commentKarma).toBe(-100);
  });

  it("drops an empty display name and leaves a missing verified-email field unobserved", () => {
    const subreddit: Record<string, unknown> = { title: "", public_description: "" };
    const signals = parseAbout(normalWith({ subreddit, has_verified_email: undefined }));
    expect(signals?.displayName).toBeUndefined();
    expect(signals?.bio).toBe("");
    expect(signals?.hasVerifiedEmail).toBeUndefined();
  });

  it("caps the bio and the display name", () => {
    const subreddit: Record<string, unknown> = {
      title: "t".repeat(200),
      public_description: "b".repeat(900),
    };
    const signals = parseAbout(normalWith({ subreddit }));
    expect(signals?.displayName).toHaveLength(100);
    expect(signals?.bio).toHaveLength(500);
  });
});

describe("parseAbout avatar detection", () => {
  it.each([
    ["https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png", true],
    ["https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png", true],
    ["", true],
    ["https://styles.redditmedia.com/t5_a1b2c3/styles/profileIcon_abc.png?width=256", false],
    ["https://i.redd.it/snoovatar/avatars/00000000-0000-4000-8000-000000000001.png", false],
  ])("icon %s → hasDefaultAvatar %s", (iconUrl, expected) => {
    expect(parseAbout(normalWith({ icon_img: iconUrl, snoovatar_img: "" }))?.hasDefaultAvatar).toBe(
      expected,
    );
  });

  it("treats a snoovatar as a custom avatar even over a default icon", () => {
    const body = normalWith({
      icon_img: "https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png",
      snoovatar_img: "https://i.redd.it/snoovatar/avatars/00000000-0000-4000-8000-000000000002.png",
    });
    expect(parseAbout(body)?.hasDefaultAvatar).toBe(false);
  });

  it("leaves the avatar unobserved when no icon field is present", () => {
    expect(
      parseAbout(normalWith({ icon_img: undefined, snoovatar_img: undefined })),
    ).not.toHaveProperty("hasDefaultAvatar");
  });
});

describe("parseAbout on unusable bodies", () => {
  it("reports a suspended stub without signals", () => {
    expect(parseAboutResponse(loadFixture("suspended.json"))).toEqual({
      status: "suspended",
      handle: "gone_account_77",
    });
    expect(parseAbout(loadFixture("suspended.json"))).toBeNull();
  });

  it("returns null for the HTML login redirect, parsed or raw", () => {
    const html: string = loadFixtureText("redirect.html");
    expect(parseAbout(html)).toBeNull();
    expect(parseAboutResponse(html)).toEqual({ status: "unavailable" });
    expect(() => JSON.parse(html)).toThrow();
  });

  it.each([null, undefined, 7, [], {}, { kind: "t3", data: { name: "x" } }, { kind: "t2" }])(
    "returns null for %p",
    (body) => {
      expect(parseAbout(body)).toBeNull();
    },
  );

  it("rejects an implausible username", () => {
    expect(parseAbout(normalWith({ name: "not a valid name!" }))).toBeNull();
    expect(parseAbout(normalWith({ name: "" }))).toBeNull();
  });
});

describe("parseAbout on mangled input", () => {
  it("leaves every oddly typed field unobserved and ignores a non-boolean is_suspended", () => {
    expect(parseAboutResponse(loadFixture("mangled.json"))).toEqual({
      status: "ok",
      handle: "odd_shape_01",
      signals: {},
    });
  });
});
