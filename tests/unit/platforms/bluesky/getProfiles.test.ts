import { readFileSync } from "node:fs";
import { TtlLruCache } from "../../../../src/core/cache";
import { AccountResolver, TIER2_CACHE_TTL_MS } from "../../../../src/core/pipeline";
import type { BadgeHandle, Scorer } from "../../../../src/core/pipeline";
import { RateLimitedError, RateLimiter } from "../../../../src/core/ratelimit";
import type {
  AccountRef,
  EffectivePlatformConfig,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  ResolveContext,
  SignalSource,
  SourceTier,
} from "../../../../src/core/types";
import {
  BATCH_WINDOW_MS,
  GET_PROFILES_ENDPOINT,
  MAX_ACTORS_PER_REQUEST,
  createGetProfilesSource,
} from "../../../../src/platforms/bluesky/sources/getProfiles";

const PROFILES_BODY: string = readFileSync(
  new URL("../../../fixtures/bluesky/get-profiles.json", import.meta.url),
  "utf8",
);

const config: EffectivePlatformConfig = {
  platform: "bluesky",
  enabled: true,
  tiers: { t1: true, t2: true },
  rateLimitPerMinute: 30,
  policyVersion: 1,
};

const ref = (handle: string, id?: string): AccountRef => ({
  platform: "bluesky",
  handle,
  ...(id === undefined ? {} : { id }),
});

const contextWith = (signal: AbortSignal = new AbortController().signal): ResolveContext => ({
  signal,
  config,
});

const jsonResponse = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });

const post = (handle: string): PostRef => ({
  element: { handle } as unknown as Element,
  ref: ref(handle),
  anchor: {} as Element,
});

const ALL_TIERS: SourceTier[] = [0, 1, 2];

const unsureScorer: Scorer = (_features, _signals, sourcesAvailable) => ({
  tier: "unknown",
  probability: 0.5,
  logOdds: 0,
  evidence: [],
  reasons: [],
  confidence: 0,
  caveat: "This can be wrong.",
  sourcesUsed: sourcesAvailable,
  sourcesMissing: ALL_TIERS.filter((tier) => !sourcesAvailable.includes(tier)),
  lowConfidence: true,
  policyVersion: 1,
  computedAt: Date.now(),
});

/** The pipeline over this source alone, so a batch's rejections reach the real limiter. */
const resolverOver = (source: SignalSource, limiter: RateLimiter): AccountResolver => {
  const adapter: PlatformAdapter = {
    id: "bluesky",
    matches: () => true,
    observeFeed: () => () => undefined,
    extractDomSignals: () => ({}),
    sources: [source],
    toFeatures: () => [],
    badgeDensity: "bluesky",
  };
  return new AccountResolver({
    adapter,
    scorer: unsureScorer,
    config,
    limiter,
    cache: new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS),
  });
};

interface Harness {
  source: SignalSource;
  fetch: ReturnType<typeof vi.fn>;
  resolve: (ref: AccountRef, signal?: AbortSignal) => Promise<PartialSignals | null>;
}

const actorsOf = (call: unknown[]): string[] =>
  new URL(String(call[0])).searchParams.getAll("actors");

const makeHarness = (
  respond: () => Response | Promise<Response> = () => jsonResponse(PROFILES_BODY),
): Harness => {
  const fetch = vi.fn(async () => respond());
  const source: SignalSource = createGetProfilesSource({ fetch });
  return {
    source,
    fetch,
    resolve: (accountRef, signal) => {
      if (source.resolve === undefined) throw new Error("source is not active");
      return source.resolve(accountRef, contextWith(signal));
    },
  };
};

describe("getProfiles source", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("declares itself as an active Tier 2 source", () => {
    expect(makeHarness().source).toMatchObject({
      id: "bluesky.getProfiles",
      platform: "bluesky",
      tier: 2,
      kind: "active",
    });
  });

  it("coalesces lookups within the window into one anonymous request", async () => {
    const { fetch, resolve } = makeHarness();

    const lookups: Promise<PartialSignals | null>[] = [
      resolve(ref("alice.example.com")),
      resolve(ref("example.social")),
      resolve(ref("alice.example.com")),
    ];
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    const [alice, example, aliceAgain] = await Promise.all(lookups);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.href.startsWith(GET_PROFILES_ENDPOINT)).toBe(true);
    expect(url.searchParams.getAll("actors")).toEqual(["alice.example.com", "example.social"]);
    expect(init.credentials).toBe("omit");
    expect(alice).toMatchObject({ followers: 15200, following: 870, postCount: 31000 });
    expect(example).toMatchObject({ verified: "none" });
    expect(aliceAgain).toEqual(alice);
  });

  it("opens a new window after the first one flushes", async () => {
    const { fetch, resolve } = makeHarness();

    const first: Promise<PartialSignals | null> = resolve(ref("alice.example.com"));
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    const second: Promise<PartialSignals | null> = resolve(ref("example.social"));
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    await Promise.all([first, second]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("splits a burst above the AppView cap into requests of at most 25 actors", async () => {
    const { fetch, resolve } = makeHarness();
    const handles: string[] = Array.from({ length: 30 }, (_, index) => `h${index}.example.com`);

    const lookups: Promise<PartialSignals | null>[] = handles.map((handle) => resolve(ref(handle)));
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    const results: (PartialSignals | null)[] = await Promise.all(lookups);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(actorsOf(fetch.mock.calls[0] ?? [])).toHaveLength(MAX_ACTORS_PER_REQUEST);
    expect(actorsOf(fetch.mock.calls[1] ?? [])).toHaveLength(5);
    expect(results.every((result) => result === null)).toBe(true);
  });

  it("matches a profile by DID when the handle has changed", async () => {
    const { resolve } = makeHarness();

    const lookup: Promise<PartialSignals | null> = resolve(
      ref("old-handle.example.com", "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb"),
    );
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    expect(await lookup).toMatchObject({ displayName: "Alice Example" });
  });

  it("rejects the first waiter of a 429 batch with RateLimitedError and the rest with a plain error", async () => {
    const { resolve } = makeHarness(
      () => new Response("slow down", { status: 429, headers: { "retry-after": "7" } }),
    );

    const lookups: Promise<PartialSignals | null>[] = [
      resolve(ref("alice.example.com")),
      resolve(ref("example.social")),
      resolve(ref("newsroom.example.org")),
    ];
    const settled = Promise.allSettled(lookups);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);

    const reasons: unknown[] = (await settled).map((outcome) =>
      outcome.status === "rejected" ? outcome.reason : undefined,
    );
    expect(reasons[0]).toBeInstanceOf(RateLimitedError);
    expect((reasons[0] as RateLimitedError).retryAfterMs).toBe(7000);
    for (const reason of reasons.slice(1)) {
      expect(reason).toBeInstanceOf(Error);
      expect(reason).not.toBeInstanceOf(RateLimitedError);
      expect((reason as Error).message).toBe("batched lookup rate limited");
    }
  });

  it("reports one rate limit to the pipeline's limiter per 429 batch", async () => {
    const { source, fetch } = makeHarness(() => new Response("", { status: 429 }));
    const limiter = new RateLimiter({ perMinute: 60, burst: 5 });
    const reportRateLimited = vi.spyOn(limiter, "reportRateLimited");
    const resolver: AccountResolver = resolverOver(source, limiter);
    const handles: BadgeHandle[] = [
      "alice.example.com",
      "example.social",
      "newsroom.example.org",
    ].map((handle) => resolver.attach(post(handle)));

    const lookups: Promise<void>[] = handles.map((handle) => handle.lookup());
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    await Promise.all(lookups);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reportRateLimited).toHaveBeenCalledTimes(1);
    expect(limiter.isOpen()).toBe(true);
    for (const handle of handles) {
      expect(handle.current().sourcesMissing).toContain(2);
    }
    resolver.dispose();
  });

  it("leaves retryAfterMs unset when the 429 carries no usable header", async () => {
    const { resolve } = makeHarness(() => new Response("", { status: 429 }));
    const lookup: Promise<PartialSignals | null> = resolve(ref("alice.example.com"));
    const settled = lookup.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    const error: unknown = await settled;
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBeUndefined();
  });

  it("rejects every waiter with a plain error on other HTTP failures and bad JSON", async () => {
    const failing: Harness = makeHarness(() => new Response("nope", { status: 500 }));
    const failed = failing.resolve(ref("alice.example.com")).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    expect(await failed).toBeInstanceOf(Error);
    expect(await failed).not.toBeInstanceOf(RateLimitedError);

    const garbled: Harness = makeHarness(() => jsonResponse("<html>"));
    const unparsed = garbled.resolve(ref("alice.example.com")).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    expect(await unparsed).toBeInstanceOf(Error);
  });

  it("honours the context signal before and during the request", async () => {
    const controller = new AbortController();
    const { fetch, resolve } = makeHarness();
    fetch.mockImplementation(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")));
        }),
    );

    const beforeWindow = resolve(ref("a.example.com"), controller.signal).catch((e: unknown) => e);
    const kept = resolve(ref("b.example.com")).catch((e: unknown) => e);
    controller.abort();
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    expect(await beforeWindow).toBeInstanceOf(DOMException);
    expect(actorsOf(fetch.mock.calls[0] ?? [])).toEqual(["b.example.com"]);

    const alreadyAborted = resolve(ref("c.example.com"), controller.signal).catch(
      (e: unknown) => e,
    );
    expect(await alreadyAborted).toBeInstanceOf(DOMException);
    expect(fetch).toHaveBeenCalledTimes(1);

    const inFlight = new AbortController();
    const duringRequest = resolve(ref("d.example.com"), inFlight.signal).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(BATCH_WINDOW_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    inFlight.abort();
    expect(await duringRequest).toBeInstanceOf(DOMException);
    expect((fetch.mock.calls[1]?.[1] as RequestInit).signal?.aborted).toBe(true);
    // The first request still serves b.example.com, so its signal stays live.
    expect((fetch.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(false);
    void kept;
  });
});
