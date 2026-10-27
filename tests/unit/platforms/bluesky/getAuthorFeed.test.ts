import { TtlLruCache } from "../../../../src/core/cache";
import { AccountResolver, TIER2_CACHE_TTL_MS } from "../../../../src/core/pipeline";
import type { Scorer } from "../../../../src/core/pipeline";
import { RateLimitedError, RateLimiter } from "../../../../src/core/ratelimit";
import type {
  AccountRef,
  AccountSignals,
  EffectivePlatformConfig,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  SignalSource,
} from "../../../../src/core/types";
import {
  GET_AUTHOR_FEED_ENDPOINT,
  createGetAuthorFeedSource,
} from "../../../../src/platforms/bluesky/sources/getAuthorFeed";

const config: EffectivePlatformConfig = {
  platform: "bluesky",
  enabled: true,
  tiers: { t1: true, t2: true },
  rateLimitPerMinute: 30,
  policyVersion: 1,
};

const owner: AccountRef = { platform: "bluesky", handle: "owner.example.com" };

const feedBody = (handle: string, times: string[]): string =>
  JSON.stringify({
    feed: times.map((createdAt) => ({
      post: { author: { did: "did:plc:owner", handle }, record: { createdAt } },
    })),
  });

const jsonResponse = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });

function harness(respond: () => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => respond());
  const source: SignalSource = createGetAuthorFeedSource({ fetch });
  const resolve = (ref: AccountRef, signal: AbortSignal = new AbortController().signal) => {
    if (source.resolve === undefined) throw new Error("source is not active");
    return source.resolve(ref, { signal, config });
  };
  return { fetch, source, resolve };
}

describe("getAuthorFeed source", () => {
  const body: string = feedBody("owner.example.com", [
    "2026-10-20T10:00:00.000Z",
    "2026-10-21T10:00:00.000Z",
  ]);

  it("declares itself as an active Tier 2 source", () => {
    expect(harness(() => jsonResponse(body)).source).toMatchObject({
      id: "bluesky.getAuthorFeed",
      platform: "bluesky",
      tier: 2,
      kind: "active",
    });
  });

  it("asks the public AppView anonymously for the actor's newest 100 posts", async () => {
    const { fetch, resolve } = harness(() => jsonResponse(body));
    const signal: AbortSignal = new AbortController().signal;
    await resolve({ ...owner, id: "did:plc:owner" }, signal);
    const [input, init] = fetch.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe(GET_AUTHOR_FEED_ENDPOINT);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      actor: "did:plc:owner",
      limit: "100",
      filter: "posts_and_author_threads",
    });
    expect(init).toMatchObject({ credentials: "omit", signal });
  });

  it("returns the actor's post times", async () => {
    const { resolve } = harness(() => jsonResponse(body));
    await expect(resolve(owner)).resolves.toEqual({
      postTimestamps: [
        Date.parse("2026-10-20T10:00:00.000Z"),
        Date.parse("2026-10-21T10:00:00.000Z"),
      ],
    });
  });

  it("returns null when the feed holds no post by the actor", async () => {
    const { resolve } = harness(() =>
      jsonResponse(feedBody("someone.else", ["2026-10-21T10:00:00Z"])),
    );
    await expect(resolve(owner)).resolves.toBeNull();
    const empty = harness(() => jsonResponse("{}"));
    await expect(empty.resolve(owner)).resolves.toBeNull();
  });

  it("reports a 429 with its retry-after, and fails on other errors", async () => {
    const limited = harness(
      () => new Response("", { status: 429, headers: { "retry-after": "7" } }),
    );
    const error: unknown = await limited.resolve(owner).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(7000);
    const broken = harness(() => new Response("", { status: 502 }));
    await expect(broken.resolve(owner)).rejects.toThrow("getAuthorFeed http 502");
  });

  describe("through the pipeline", () => {
    const passthrough: Scorer = (_features, signals: AccountSignals) => ({
      tier: "unknown",
      probability: 0,
      logOdds: 0,
      evidence: [],
      reasons: [
        {
          text: String(signals.postTimestamps?.length ?? 0),
          why: "",
          direction: "automated",
          tier: 2,
        },
      ],
      confidence: 0,
      caveat: "",
      sourcesUsed: [],
      sourcesMissing: [],
      lowConfidence: true,
      policyVersion: 1,
      computedAt: 0,
    });

    const resolverWith = (
      sources: SignalSource | SignalSource[],
      limiter: RateLimiter,
      t2 = true,
    ) =>
      new AccountResolver({
        adapter: {
          id: "bluesky",
          matches: () => true,
          observeFeed: () => () => undefined,
          extractDomSignals: () => ({}),
          sources: Array.isArray(sources) ? sources : [sources],
          toFeatures: () => [],
          badgeDensity: "bluesky",
        } satisfies PlatformAdapter,
        scorer: passthrough,
        config: { ...config, tiers: { t1: true, t2 } },
        limiter,
        cache: new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS),
      });

    const postBy = (handle: string): PostRef => ({
      element: { handle } as unknown as Element,
      ref: { platform: "bluesky", handle },
      anchor: {} as Element,
    });

    it("spends a limiter token per hover and answers repeats from the cache", async () => {
      const { fetch, source } = harness(() => jsonResponse(body));
      const limiter = new RateLimiter({ perMinute: 30, burst: 6 });
      const resolver: AccountResolver = resolverWith(source, limiter);
      const badge = resolver.attach(postBy("owner.example.com"));
      await badge.lookup();
      await badge.lookup();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(badge.current().reasons[0]?.text).toBe("2");
      resolver.dispose();
    });

    /** A second active source standing in for getProfiles. */
    const profilesSource = (resolve: () => Promise<PartialSignals | null>): SignalSource => ({
      id: "profiles",
      platform: "bluesky",
      tier: 2,
      kind: "active",
      resolve,
    });

    it("runs a lookup only when every source's token is there, all taken up front", async () => {
      const { fetch, source } = harness(() => jsonResponse(body));
      const profiles = vi.fn(async (): Promise<PartialSignals | null> => ({ followers: 3 }));
      const limiter = new RateLimiter({ perMinute: 30, burst: 2 });
      const resolver: AccountResolver = resolverWith([profilesSource(profiles), source], limiter);
      const badge = resolver.attach(postBy("owner.example.com"));
      expect(limiter.tryAcquire()).toBe(true);
      await badge.lookup();
      expect(profiles).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      resolver.dispose();

      const fresh = new RateLimiter({ perMinute: 30, burst: 2 });
      const second: AccountResolver = resolverWith([profilesSource(profiles), source], fresh);
      await second.attach(postBy("owner.example.com")).lookup();
      expect(profiles).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fresh.tryAcquire()).toBe(false);
      second.dispose();
    });

    it("scores a lookup a source failed in, but does not cache it, so a hover asks again", async () => {
      const { fetch, source } = harness(() => new Response("", { status: 502 }));
      const profiles = vi.fn(async (): Promise<PartialSignals | null> => ({ followers: 3 }));
      const resolver: AccountResolver = resolverWith(
        [profilesSource(profiles), source],
        new RateLimiter({ perMinute: 30, burst: 6 }),
      );
      const badge = resolver.attach(postBy("owner.example.com"));
      await badge.lookup();
      expect(badge.lookupStatus()).toBe("delivered");
      await badge.lookup();
      expect(profiles).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(2);
      resolver.dispose();
    });

    it("never runs while Tier 2 is off", async () => {
      const { fetch, source } = harness(() => jsonResponse(body));
      const resolver: AccountResolver = resolverWith(
        source,
        new RateLimiter({ perMinute: 30, burst: 6 }),
        false,
      );
      await resolver.attach(postBy("owner.example.com")).lookup();
      expect(fetch).not.toHaveBeenCalled();
      resolver.dispose();
    });
  });
});
