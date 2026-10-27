import { readFileSync } from "node:fs";

import type { FirebaseUserParseResult } from "@/src/platforms/hackernews/parsers/user";
import { aboutText, parseFirebaseUser } from "@/src/platforms/hackernews/parsers/user";

const recorded = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/hackernews/firebase/${name}`, import.meta.url), "utf8"),
  );

describe("parseFirebaseUser on the recordings", () => {
  it("reads age, karma, submissions and the about text of an established account", () => {
    const result: FirebaseUserParseResult = parseFirebaseUser(recorded("user.json"));
    expect(result).toEqual({
      status: "ok",
      id: "priya_draws71",
      signals: {
        createdAt: 1_362_458_464_000,
        karma: 595,
        postCount: 147,
        bio: "I solve problems and take pictures https://example.com",
      },
    });
  });

  it("records an empty bio for an account whose profile has no about field", () => {
    const result: FirebaseUserParseResult = parseFirebaseUser(recorded("user-new.json"));
    expect(result).toEqual({
      status: "ok",
      id: "lena_draws92",
      signals: { createdAt: 1_793_035_984_000, karma: 2, postCount: 1, bio: "" },
    });
  });
});

describe("parseFirebaseUser on untrusted bodies", () => {
  it("tells an unknown id (a JSON null) apart from a malformed body", () => {
    expect(parseFirebaseUser(null)).toEqual({ status: "missing" });
    for (const body of [undefined, "dang", 42, [], {}, { id: 7 }]) {
      expect(parseFirebaseUser(body)).toEqual({ status: "unavailable" });
    }
  });

  it("drops fields of the wrong type instead of guessing", () => {
    const result: FirebaseUserParseResult = parseFirebaseUser({
      id: "someone",
      created: "2020",
      karma: 1.5,
      submitted: [1, "2", null, 3],
      about: 12,
    });
    expect(result).toEqual({
      status: "ok",
      id: "someone",
      signals: { postCount: 2, bio: "" },
    });
  });

  it("caps the about text and reads a first-person bot declaration in it", () => {
    const result: FirebaseUserParseResult = parseFirebaseUser({
      id: "digest_helper",
      about: `I&#x27;m a summary bot run by <a href="https:&#x2F;&#x2F;example.com">example</a>.<p>${"x".repeat(900)}`,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.signals.declaredAutomated).toBe(true);
    expect(result.signals.declaredBy).toBe("bio");
    expect(result.signals.bio).toHaveLength(500);
  });

  it("does not read a bot hunter's about text as a declaration", () => {
    const result: FirebaseUserParseResult = parseFirebaseUser({
      id: "hunter",
      about: "I hunt bots for a living.",
    });
    expect(result.status === "ok" ? result.signals.declaredAutomated : "not ok").toBeUndefined();
  });
});

describe("aboutText", () => {
  it("turns the API's HTML into plain text without decoding twice", () => {
    expect(aboutText("Hello<p>I&#x27;m &quot;here&quot; &amp;lt;3")).toBe(`Hello I'm "here" &lt;3`);
  });
});
