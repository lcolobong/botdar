import { readFileSync } from "node:fs";

import { RateLimitedError } from "@/src/core/ratelimit";
import type { AccountRef, AccountSignals, ResolveContext } from "@/src/core/types";
import { parseOverviewResponse } from "@/src/platforms/reddit/parsers/overview";
import { createLoginPause } from "@/src/platforms/reddit/sources/redditJson";
import {
  OVERVIEW_JSON_SOURCE_ID,
  createOverviewJsonSource,
  overviewJsonPath,
} from "@/src/platforms/reddit/sources/overviewJson";

// The fixtures are hand-written in the documented listing shape (see their _fixture note).
const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/reddit/overview/${name}`, import.meta.url), "utf8"),
  );

const ref: AccountRef = { platform: "reddit", handle: "quiet_lantern_4821" };

const context: ResolveContext = {
  signal: new AbortController().signal,
  config: {
    platform: "reddit",
    enabled: true,
    tiers: { t1: false, t2: true },
    rateLimitPerMinute: 30,
    policyVersion: 1,
  },
};

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("parseOverviewResponse", () => {
  it("reads the oldest created_utc and the item count of a short listing", () => {
    expect(parseOverviewResponse(fixture("short.json"))).toEqual({
      status: "ok",
      signals: { oldestItemAt: 1_756_544_000_000, visibleItemCount: 3 },
    });
  });

  it("reports the page size when the listing continues, so the oldest item is not the first", () => {
    const result = parseOverviewResponse(fixture("full.json"));
    expect(result).toMatchObject({ status: "ok", signals: { visibleItemCount: 100 } });
  });

  it("reports an empty listing as zero items with no timestamp", () => {
    expect(parseOverviewResponse(fixture("empty.json"))).toEqual({
      status: "ok",
      signals: { visibleItemCount: 0 },
    });
  });

  it("skips items without a usable created_utc and counts only the rest", () => {
    const body = {
      kind: "Listing",
      data: {
        after: null,
        children: [
          { kind: "t1", data: { created_utc: 1_700_000_000 } },
          { kind: "t1", data: { created_utc: "1600000000" } },
          { kind: "t3", data: { created_utc: -5 } },
          { kind: "t3", data: {} },
          "nonsense",
        ],
      },
    };
    expect(parseOverviewResponse(body)).toEqual({
      status: "ok",
      signals: { oldestItemAt: 1_700_000_000_000, visibleItemCount: 1 },
    });
  });

  it.each([null, "<html></html>", [], { kind: "t2", data: {} }, { kind: "Listing" }])(
    "returns unavailable for %j",
    (body) => {
      expect(parseOverviewResponse(body)).toEqual({ status: "unavailable" });
    },
  );
});

describe("overview.json source", () => {
  it("declares an active Tier 2 hover-only Reddit source", () => {
    const source = createOverviewJsonSource();
    expect(source).toMatchObject({
      id: OVERVIEW_JSON_SOURCE_ID,
      platform: "reddit",
      tier: 2,
      kind: "active",
      hoverOnly: true,
    });
  });

  it("is worth a request only for an account past the karma-rate age gate", () => {
    const now = 1_800_000_000_000;
    const source = createOverviewJsonSource({ now: () => now });
    const signalsAged = (days: number): AccountSignals => ({
      ref,
      createdAt: now - days * 86_400_000,
      provenance: {},
      tiersDelivered: [],
      observedAt: now,
    });
    expect(source.worthResolving?.(signalsAged(179))).toBe(false);
    expect(source.worthResolving?.(signalsAged(180))).toBe(true);
    expect(
      source.worthResolving?.({ ref, provenance: {}, tiersDelivered: [], observedAt: now }),
    ).toBe(false);
  });

  it("asks for the newest 100 items with the user's cookies", () => {
    expect(overviewJsonPath("quiet_lantern_4821")).toBe(
      "/user/quiet_lantern_4821/overview.json?limit=100",
    );
    expect(overviewJsonPath("a/b")).toBe("/user/a%2Fb/overview.json?limit=100");
  });

  it("fetches same-origin with the abort signal and returns the two numbers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(fixture("short.json")));
    const source = createOverviewJsonSource({ fetch: fetchMock as unknown as typeof fetch });
    const controller = new AbortController();
    const signals = await source.resolve?.(ref, { ...context, signal: controller.signal });
    expect(signals).toEqual({ oldestItemAt: 1_756_544_000_000, visibleItemCount: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/user/quiet_lantern_4821/overview.json?limit=100",
      expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
    );
  });

  it("raises a rate-limit error carrying Retry-After on 429", async () => {
    const source = createOverviewJsonSource({
      fetch: (async () =>
        new Response("", { status: 429, headers: { "retry-after": "30" } })) as typeof fetch,
      now: () => 1_700_000_000_000,
    });
    const error: unknown = await source.resolve?.(ref, context).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(30_000);
  });

  it.each([
    ["a server error", () => new Response("", { status: 500 })],
    ["a body that is not a listing", () => jsonResponse({ kind: "t2" })],
    ["a body that is not JSON", () => new Response("nope", { status: 200 })],
  ])("returns nothing for %s", async (_label, respond) => {
    const source = createOverviewJsonSource({ fetch: (async () => respond()) as typeof fetch });
    expect(await source.resolve?.(ref, context)).toBeNull();
  });

  it.each([["a 404", () => new Response("", { status: 404 })]])(
    "keeps %s as an empty listing, so the next hover does not ask again",
    async (_label, respond) => {
      const source = createOverviewJsonSource({ fetch: (async () => respond()) as typeof fetch });
      expect(await source.resolve?.(ref, context)).toEqual({ visibleItemCount: 0 });
    },
  );

  it.each([
    ["a 401", () => new Response("", { status: 401 })],
    ["a 403", () => new Response("", { status: 403 })],
    [
      "an HTML login page",
      () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    ],
  ])(
    "trips the pause it shares with about.json on %s and then stays quiet",
    async (_label, respond) => {
      const loginPause = createLoginPause();
      const fetchMock = vi.fn(async () => respond());
      const source = createOverviewJsonSource({
        fetch: fetchMock as unknown as typeof fetch,
        loginPause,
      });
      expect(await source.resolve?.(ref, context)).toBeNull();
      expect(loginPause.active()).toBe(true);
      expect(await source.resolve?.(ref, context)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("returns nothing when the request fails outright", async () => {
    const source = createOverviewJsonSource({
      fetch: (async () => {
        throw new TypeError("offline");
      }) as typeof fetch,
    });
    expect(await source.resolve?.(ref, context)).toBeNull();
  });
});
