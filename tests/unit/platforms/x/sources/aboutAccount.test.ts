import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RateLimitedError, retryAfterMsFrom } from "@/src/core/ratelimit";
import type { EffectivePlatformConfig, ResolveContext, SignalSource } from "@/src/core/types";
import { FALLBACK_ABOUT_ACCOUNT_QUERY_ID, QueryIdRegistry } from "@/src/platforms/x/queryIds";
import type { FetchFn } from "@/src/platforms/x/sources/aboutAccount";
import {
  ABOUT_ACCOUNT_SOURCE_ID,
  X_WEB_BEARER_TOKEN,
  createAboutAccountSource,
  readCookie,
} from "@/src/platforms/x/sources/aboutAccount";

const aboutFixture: string = readFileSync(
  join(process.cwd(), "tests/fixtures/x/graphql/about-account.json"),
  "utf8",
);

const config = (overrides: Partial<EffectivePlatformConfig> = {}): EffectivePlatformConfig => ({
  platform: "x",
  enabled: true,
  tiers: { t1: true, t2: true },
  rateLimitPerMinute: 20,
  policyVersion: 1,
  ...overrides,
});

interface Harness {
  source: SignalSource;
  registry: QueryIdRegistry;
  fetch: ReturnType<typeof vi.fn<FetchFn>>;
  context: ResolveContext;
}

function makeHarness(
  response: Response | Error,
  options: { csrf?: string | undefined; config?: EffectivePlatformConfig } = {},
): Harness {
  const registry = new QueryIdRegistry();
  const fetch = vi.fn<FetchFn>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone()),
  );
  const source: SignalSource = createAboutAccountSource({
    registry,
    fetch,
    readCsrfToken: () => ("csrf" in options ? options.csrf : "csrf-token-123"),
  });
  const context: ResolveContext = {
    signal: new AbortController().signal,
    config: options.config ?? config(),
  };
  return { source, registry, fetch, context };
}

const kai = { platform: "x" as const, handle: "kai09127364" };

async function resolve(harness: Harness, handle: string = kai.handle) {
  if (harness.source.resolve === undefined) throw new Error("source has no resolve");
  return harness.source.resolve({ platform: "x", handle }, harness.context);
}

describe("readCookie", () => {
  it("finds the named cookie among others and tolerates '=' in values", () => {
    expect(readCookie("guest_id=v1; ct0=abc=def ; lang=en", "ct0")).toBe("abc=def");
    expect(readCookie("guest_id=v1", "ct0")).toBeUndefined();
    expect(readCookie("ct0=", "ct0")).toBeUndefined();
    expect(readCookie("", "ct0")).toBeUndefined();
  });
});

describe("retryAfterMsFrom", () => {
  const now: number = Date.UTC(2026, 9, 22, 12, 0, 0);

  it("reads seconds, an HTTP date, or the X reset epoch, taking the later one", () => {
    expect(retryAfterMsFrom(new Headers({ "retry-after": "30" }), now)).toBe(30_000);
    expect(
      retryAfterMsFrom(new Headers({ "retry-after": new Date(now + 90_000).toUTCString() }), now),
    ).toBe(90_000);
    expect(
      retryAfterMsFrom(new Headers({ "x-rate-limit-reset": String(now / 1000 + 120) }), now),
    ).toBe(120_000);
    expect(
      retryAfterMsFrom(
        new Headers({ "retry-after": "5", "x-rate-limit-reset": String(now / 1000 + 45) }),
        now,
      ),
    ).toBe(45_000);
  });

  it("returns undefined for missing, malformed or past values", () => {
    expect(retryAfterMsFrom(new Headers(), now)).toBeUndefined();
    expect(retryAfterMsFrom(new Headers({ "retry-after": "soon" }), now)).toBeUndefined();
    expect(retryAfterMsFrom(new Headers({ "retry-after": "-5" }), now)).toBeUndefined();
    expect(
      retryAfterMsFrom(new Headers({ "x-rate-limit-reset": String(now / 1000 - 1) }), now),
    ).toBeUndefined();
  });
});

describe("createAboutAccountSource", () => {
  it("declares itself as the active Tier 2 source for x", () => {
    expect(makeHarness(new Response("{}")).source).toMatchObject({
      id: ABOUT_ACCOUNT_SOURCE_ID,
      platform: "x",
      tier: 2,
      kind: "active",
    });
  });

  it("GETs AboutAccountQuery with the web bearer, the csrf cookie and credentials", async () => {
    const harness: Harness = makeHarness(new Response(aboutFixture, { status: 200 }));

    const signals = await resolve(harness);

    expect(signals).toEqual({
      country: "United States",
      usernameChanges: 3,
      appStore: "App Store",
      declaredAutomated: false,
    });
    expect(harness.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = harness.fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://x.com/i/api/graphql/${FALLBACK_ABOUT_ACCOUNT_QUERY_ID}/AboutAccountQuery?variables=${encodeURIComponent('{"screenName":"kai09127364"}')}`,
    );
    expect(init).toMatchObject({
      method: "GET",
      credentials: "include",
      signal: harness.context.signal,
      headers: {
        authorization: `Bearer ${X_WEB_BEARER_TOKEN}`,
        "x-csrf-token": "csrf-token-123",
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
      },
    });
  });

  it("prefers an observed query id, then the policy's", async () => {
    const harness: Harness = makeHarness(new Response(aboutFixture), {
      config: config({ aboutAccountQueryId: "PolicyQueryId_000002" }),
    });
    await resolve(harness);
    expect(harness.fetch.mock.calls[0]?.[0]).toContain("/PolicyQueryId_000002/");

    harness.registry.observe("AboutAccountQuery", "ObservedQueryId_0001");
    await resolve(harness);
    expect(harness.fetch.mock.calls[1]?.[0]).toContain("/ObservedQueryId_0001/");
  });

  it("throws RateLimitedError with the server's Retry-After on 429", async () => {
    const harness: Harness = makeHarness(
      new Response("", { status: 429, headers: { "retry-after": "120" } }),
    );
    const failure: unknown = await resolve(harness).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RateLimitedError);
    expect((failure as RateLimitedError).retryAfterMs).toBeGreaterThan(119_000);
    expect((failure as RateLimitedError).retryAfterMs).toBeLessThanOrEqual(120_000);
  });

  it("marks the query id stale and returns null on 404", async () => {
    const harness: Harness = makeHarness(new Response("", { status: 404 }));
    expect(await resolve(harness)).toBeNull();
    expect(harness.registry.resolve("AboutAccountQuery")).toBeUndefined();
    expect(await resolve(harness)).toBeNull();
    expect(harness.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns null on other failures, a mismatched handle and a non-About body", async () => {
    expect(await resolve(makeHarness(new Response("", { status: 403 })))).toBeNull();
    expect(await resolve(makeHarness(new Response(aboutFixture)), "someone_else")).toBeNull();
    expect(await resolve(makeHarness(new Response('{"data":{}}')))).toBeNull();
  });

  it("does not request without a csrf cookie or while Tier 2 is off", async () => {
    const noCookie: Harness = makeHarness(new Response(aboutFixture), { csrf: undefined });
    expect(await resolve(noCookie)).toBeNull();
    expect(noCookie.fetch).not.toHaveBeenCalled();

    const paused: Harness = makeHarness(new Response(aboutFixture), {
      config: config({ tiers: { t1: true, t2: false } }),
    });
    expect(await resolve(paused)).toBeNull();
    expect(paused.fetch).not.toHaveBeenCalled();
  });

  it("lets a network failure propagate so the pipeline can skip the lookup", async () => {
    await expect(resolve(makeHarness(new Error("offline")))).rejects.toThrow("offline");
  });
});
