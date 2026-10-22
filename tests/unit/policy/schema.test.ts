import { PolicyValidationError, validatePolicy } from "../../../src/core/policy/schema.ts";
import type { Policy } from "../../../src/core/policy/schema.ts";

function fullPolicy(): Record<string, unknown> {
  return {
    schema: 1,
    version: 3,
    issuedAt: "2026-10-22T00:00:00Z",
    minExtensionVersion: "0.1.0",
    platforms: {
      x: {
        enabled: true,
        tiers: { t1: true, t2: false },
        thresholds: { some: 0.3, many: 0.65 },
        prior: -3,
        features: {
          "x.postsPerDay": {
            cap: 1.5,
            bins: [
              [0, 10, 0],
              [10, null, 1.2],
            ],
          },
          "x.handleNameDigits": { weight: 0.4 },
        },
        rateLimitPerMinute: 10,
        x: { aboutAccountQueryId: "abcdefghijklmnopqrstuvwxyz" },
      },
      reddit: { enabled: true, tiers: { t2: false } },
      bluesky: { enabled: false },
    },
    notice: { id: "2026-10-a", text: "X lookups paused", url: "https://example.org/notice" },
  };
}

function withPath(path: string[], value: unknown): Record<string, unknown> {
  const policy: Record<string, unknown> = fullPolicy();
  let cursor: Record<string, unknown> = policy;
  for (const key of path.slice(0, -1)) {
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last: string | undefined = path[path.length - 1];
  if (last === undefined) throw new Error("path must not be empty");
  if (value === undefined) {
    delete cursor[last];
  } else {
    cursor[last] = value;
  }
  return policy;
}

function expectFailureAt(input: unknown, path: string): void {
  let caught: unknown;
  try {
    validatePolicy(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PolicyValidationError);
  expect((caught as PolicyValidationError).path).toBe(path);
}

describe("validatePolicy", () => {
  it("accepts a full policy and returns a plain copy with every field", () => {
    const input: Record<string, unknown> = fullPolicy();
    const policy: Policy = validatePolicy(input);
    expect(policy).toEqual(input);
    expect(policy).not.toBe(input);
    expect(policy.platforms.x).not.toBe(input.platforms);
  });

  it("accepts a minimal policy", () => {
    const policy: Policy = validatePolicy({
      schema: 1,
      version: 1,
      issuedAt: "2026-10-22T00:00:00Z",
      minExtensionVersion: "0.1.0",
      platforms: {},
    });
    expect(policy.platforms).toEqual({});
    expect(policy.notice).toBeUndefined();
  });

  it("keeps unknown platform ids and feature ids for the merge to ignore", () => {
    const policy: Policy = validatePolicy(
      withPath(["platforms", "mastodon"], {
        enabled: false,
        features: { "m.unknown": { cap: 1 } },
      }),
    );
    expect(policy.platforms.mastodon?.enabled).toBe(false);
    expect(policy.platforms.mastodon?.features?.["m.unknown"]?.cap).toBe(1);
  });

  it("accepts null bounds in bins", () => {
    const policy: Policy = validatePolicy(
      withPath(["platforms", "x", "features", "x.postsPerDay", "bins"], [[null, null, 0.5]]),
    );
    expect(policy.platforms.x?.features?.["x.postsPerDay"]?.bins).toEqual([[null, null, 0.5]]);
  });

  describe("document shape", () => {
    it.each([[null], [undefined], [1], ["policy"], [[]]])(
      "rejects a non-object document %p",
      (input) => {
        expectFailureAt(input, "policy");
      },
    );

    it("rejects an unknown top-level key", () => {
      expectFailureAt(withPath(["rateLimit"], {}), "policy.rateLimit");
    });

    it.each([0, 2, "1", undefined])("rejects schema %p", (schema) => {
      expectFailureAt(withPath(["schema"], schema), "policy.schema");
    });

    it.each([0, -1, 1.5, "3", undefined, Number.MAX_SAFE_INTEGER + 1])(
      "rejects version %p",
      (version) => {
        expectFailureAt(withPath(["version"], version), "policy.version");
      },
    );

    it.each(["not a date", "", 1700000000, undefined])("rejects issuedAt %p", (issuedAt) => {
      expectFailureAt(withPath(["issuedAt"], issuedAt), "policy.issuedAt");
    });

    it.each(["1.0", "v1.0.0", "", 1, undefined])(
      "rejects minExtensionVersion %p",
      (minExtensionVersion) => {
        expectFailureAt(
          withPath(["minExtensionVersion"], minExtensionVersion),
          "policy.minExtensionVersion",
        );
      },
    );

    it.each([[undefined], [null], [[]], ["x"]])("rejects platforms %p", (platforms) => {
      expectFailureAt(withPath(["platforms"], platforms), "policy.platforms");
    });

    it("rejects an empty platform id", () => {
      expectFailureAt(withPath(["platforms", ""], { enabled: true }), "policy.platforms.");
    });
  });

  describe("platform entries", () => {
    it.each([[null], [true], [[]]])("rejects a non-object platform %p", (platform) => {
      expectFailureAt(withPath(["platforms", "x"], platform), "policy.platforms.x");
    });

    it("rejects an unknown platform key", () => {
      expectFailureAt(withPath(["platforms", "x", "enabeld"], true), "policy.platforms.x.enabeld");
    });

    it.each([undefined, "true", 1])("rejects enabled %p", (enabled) => {
      expectFailureAt(
        withPath(["platforms", "x", "enabled"], enabled),
        "policy.platforms.x.enabled",
      );
    });

    it("rejects a non-boolean tier switch", () => {
      expectFailureAt(
        withPath(["platforms", "x", "tiers", "t2"], 0),
        "policy.platforms.x.tiers.t2",
      );
    });

    it("rejects an unknown tier", () => {
      expectFailureAt(
        withPath(["platforms", "x", "tiers", "t3"], true),
        "policy.platforms.x.tiers.t3",
      );
    });

    it.each([-0.1, 1.1, "0.5", Number.NaN])("rejects threshold %p", (threshold) => {
      expectFailureAt(
        withPath(["platforms", "x", "thresholds", "many"], threshold),
        "policy.platforms.x.thresholds.many",
      );
    });

    it("rejects an unknown threshold key", () => {
      expectFailureAt(
        withPath(["platforms", "x", "thresholds", "most"], 0.9),
        "policy.platforms.x.thresholds.most",
      );
    });

    it.each(["-2", Number.POSITIVE_INFINITY, null])("rejects prior %p", (prior) => {
      expectFailureAt(withPath(["platforms", "x", "prior"], prior), "policy.platforms.x.prior");
    });

    it.each([-1, 1.5, 601, "20"])("rejects rateLimitPerMinute %p", (rateLimit) => {
      expectFailureAt(
        withPath(["platforms", "x", "rateLimitPerMinute"], rateLimit),
        "policy.platforms.x.rateLimitPerMinute",
      );
    });

    it("rejects an unknown x key", () => {
      expectFailureAt(
        withPath(["platforms", "x", "x", "queryId"], "abc"),
        "policy.platforms.x.x.queryId",
      );
    });

    it.each(["", 1, "a".repeat(65)])("rejects aboutAccountQueryId %p", (queryId) => {
      expectFailureAt(
        withPath(["platforms", "x", "x", "aboutAccountQueryId"], queryId),
        "policy.platforms.x.x.aboutAccountQueryId",
      );
    });
  });

  describe("feature overrides", () => {
    const feature: string[] = ["platforms", "x", "features", "x.postsPerDay"];

    it.each([[null], [[]], ["cap"]])("rejects a non-object feature %p", (override) => {
      expectFailureAt(withPath(feature, override), "policy.platforms.x.features.x.postsPerDay");
    });

    it("rejects a non-object features map", () => {
      expectFailureAt(withPath(["platforms", "x", "features"], []), "policy.platforms.x.features");
    });

    it("rejects an unknown feature key", () => {
      expectFailureAt(
        withPath([...feature, "group"], "activity"),
        "policy.platforms.x.features.x.postsPerDay.group",
      );
    });

    it.each([-0.1, "1", Number.NaN])("rejects cap %p", (cap) => {
      expectFailureAt(
        withPath([...feature, "cap"], cap),
        "policy.platforms.x.features.x.postsPerDay.cap",
      );
    });

    it.each(["0.5", Number.NEGATIVE_INFINITY])("rejects weight %p", (weight) => {
      expectFailureAt(
        withPath([...feature, "weight"], weight),
        "policy.platforms.x.features.x.postsPerDay.weight",
      );
    });

    it("rejects bins that are not an array", () => {
      expectFailureAt(
        withPath([...feature, "bins"], {}),
        "policy.platforms.x.features.x.postsPerDay.bins",
      );
    });

    it("rejects more than 32 bins", () => {
      const bins: unknown[] = Array.from({ length: 33 }, (_, index) => [index, index + 1, 0]);
      expectFailureAt(
        withPath([...feature, "bins"], bins),
        "policy.platforms.x.features.x.postsPerDay.bins",
      );
    });

    it.each([[[0, 10]], [[0, 10, 0, 0]], ["bin"], [[10, 0, 1]], [[0, 0, 1]]])(
      "rejects malformed bin %p",
      (bin) => {
        expectFailureAt(
          withPath([...feature, "bins"], [bin]),
          "policy.platforms.x.features.x.postsPerDay.bins[0]",
        );
      },
    );

    it("rejects a bin bound that is neither a number nor null", () => {
      expectFailureAt(
        withPath(
          [...feature, "bins"],
          [
            [0, 10, 0],
            ["0", 10, 1],
          ],
        ),
        "policy.platforms.x.features.x.postsPerDay.bins[1][0]",
      );
    });

    it("rejects a non-finite bin log-odds", () => {
      expectFailureAt(
        withPath([...feature, "bins"], [[0, 10, Number.NaN]]),
        "policy.platforms.x.features.x.postsPerDay.bins[0][2]",
      );
    });
  });

  describe("notice", () => {
    it.each([[null], ["text"], [[]]])("rejects a non-object notice %p", (notice) => {
      expectFailureAt(withPath(["notice"], notice), "policy.notice");
    });

    it("rejects an unknown notice key", () => {
      expectFailureAt(withPath(["notice", "title"], "t"), "policy.notice.title");
    });

    it.each([undefined, "", 1, "a".repeat(65)])("rejects notice id %p", (id) => {
      expectFailureAt(withPath(["notice", "id"], id), "policy.notice.id");
    });

    it.each([undefined, "", "a".repeat(501)])("rejects notice text %p", (text) => {
      expectFailureAt(withPath(["notice", "text"], text), "policy.notice.text");
    });

    it.each(["http://example.org", "/relative", "", 1])("rejects notice url %p", (url) => {
      expectFailureAt(withPath(["notice", "url"], url), "policy.notice.url");
    });
  });
});
