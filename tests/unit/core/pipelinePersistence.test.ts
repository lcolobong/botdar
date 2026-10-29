import { fakeBrowser } from "wxt/testing/fake-browser";
import { TtlLruCache } from "@/src/core/cache";
import { LOOKUP_TTL_MS, PersistedLookupStore } from "@/src/core/persistedLookups";
import { AccountResolver, TIER2_CACHE_TTL_MS } from "@/src/core/pipeline";
import type { Scorer } from "@/src/core/pipeline";
import { RateLimiter } from "@/src/core/ratelimit";
import type {
  AccountRef,
  AccountSignals,
  EffectivePlatformConfig,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  SignalSource,
} from "@/src/core/types";
import { fakeReason } from "../../fakeReasons";

const scorer: Scorer = (_features, signals, sourcesAvailable) => ({
  tier: "typical",
  probability: 0.5,
  logOdds: 0,
  evidence: [],
  reasons: [fakeReason(`followers=${signals.followers ?? "none"}`, 2)],
  confidence: 0.5,
  caveat: "This can be wrong.",
  sourcesUsed: sourcesAvailable,
  sourcesMissing: [],
  lowConfidence: false,
  policyVersion: 1,
  computedAt: Date.now(),
});

const config = (t2: boolean): EffectivePlatformConfig => ({
  platform: "x",
  enabled: true,
  tiers: { t1: true, t2 },
  rateLimitPerMinute: 60,
  policyVersion: 1,
});

interface Harness {
  resolver: AccountResolver;
  resolve: ReturnType<typeof vi.fn>;
  cache: TtlLruCache<string, PartialSignals>;
  store: PersistedLookupStore;
  setEnabled: (enabled: boolean) => void;
  setConfig: (t2: boolean) => void;
}

interface HarnessOptions {
  store?: PersistedLookupStore;
  limiter?: RateLimiter;
  cacheNow?: () => number;
}

function makeHarness(t2 = true, options: HarnessOptions = {}): Harness {
  const resolve = vi.fn(async (): Promise<PartialSignals | null> => ({
    followers: 12,
    displayName: "Name",
  }));
  const active: SignalSource = { id: "x.about", platform: "x", tier: 2, kind: "active", resolve };
  const adapter: PlatformAdapter = {
    id: "x",
    matches: () => true,
    observeFeed: () => () => undefined,
    extractDomSignals: () => ({}),
    sources: [active],
    toFeatures: (signals: AccountSignals) => (signals.followers === undefined ? [] : []),
    badgeDensity: "x",
  };
  const cache = new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS, options.cacheNow);
  const store: PersistedLookupStore = options.store ?? new PersistedLookupStore();
  let enabled = true;
  const resolver = new AccountResolver({
    adapter,
    scorer,
    config: config(t2),
    limiter: options.limiter ?? new RateLimiter({ perMinute: 60, burst: 2 }),
    cache,
    persistence: { store, enabled: () => enabled },
  });
  const setConfig = (next: boolean): void => resolver.updateConfig(config(next));
  return { resolver, resolve, cache, store, setEnabled: (next) => (enabled = next), setConfig };
}

const ref = (handle = "someone"): AccountRef => ({ platform: "x", handle });
const post = (handle = "someone"): PostRef => ({
  element: { handle } as unknown as Element,
  ref: ref(handle),
  anchor: {} as Element,
});

async function storedLookupCount(): Promise<number> {
  const everything: Record<string, unknown> = await fakeBrowser.storage.local.get(null);
  return Object.keys(everything).filter((key) => key.startsWith("lookups.v1.")).length;
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("AccountResolver with persisted lookups", () => {
  it("writes a successful Tier 2 delivery to storage without the display name", async () => {
    const { resolver, store } = makeHarness();
    await resolver.attach(post()).lookup();

    await vi.waitFor(async () =>
      expect((await store.read("x", "someone"))?.signals).toEqual({ followers: 12 }),
    );
  });

  it("serves a memory miss from storage without calling the platform, then fills memory", async () => {
    const { resolver, resolve, cache, store } = makeHarness();
    await store.write("x", "someone", { followers: 99 });

    const handle = resolver.attach(post());
    await handle.lookup();

    expect(resolve).not.toHaveBeenCalled();
    expect(cache.get("someone")).toEqual({ followers: 99 });
    expect(handle.current().reasons.map((reason) => reason.text)).toContain("followers=99");
    expect(handle.lookupStatus()).toBe("delivered");
  });

  it("serves an on-sight lookup from storage without the queue", async () => {
    const { resolver, resolve, store } = makeHarness();
    await store.write("x", "someone", { followers: 99 });

    const handle = resolver.attach(post());
    await handle.lookupOnSight();

    expect(resolve).not.toHaveBeenCalled();
    expect(handle.lookupStatus()).toBe("delivered");
  });

  it("fetches and writes when storage misses", async () => {
    const { resolver, resolve } = makeHarness();
    await resolver.attach(post()).lookup();

    expect(resolve).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect(await storedLookupCount()).toBe(1));
  });

  it("neither reads nor writes while persistLookups is off", async () => {
    const { resolver, resolve, store, setEnabled } = makeHarness();
    await store.write("x", "someone", { followers: 99 });
    setEnabled(false);

    await resolver.attach(post()).lookup();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect((await store.read("x", "someone"))?.signals).toEqual({ followers: 99 });
    await resolver.attach(post("another")).lookup();
    expect(await storedLookupCount()).toBe(1);
  });

  it("neither reads nor writes when Tier 2 is off", async () => {
    const { resolver, resolve, store } = makeHarness(false);
    await store.write("x", "someone", { followers: 99 });

    await resolver.attach(post()).lookup();

    expect(resolve).not.toHaveBeenCalled();
    expect(await storedLookupCount()).toBe(1);
  });
});

/** A store whose reads wait until the test releases them, to interleave events with a storage read. */
function slowStore(): { store: PersistedLookupStore; release: () => void } {
  const waiting: Array<() => void> = [];
  const store = new PersistedLookupStore();
  vi.spyOn(store, "read").mockImplementation(
    () => new Promise((resolve) => waiting.push(() => resolve(undefined))),
  );
  return { store, release: () => waiting.splice(0).forEach((resume) => resume()) };
}

describe("AccountResolver while a storage read is in flight", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a hover during the read move the account to the front of the queue", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ perMinute: 60, burst: 1 });
    limiter.tryAcquire();
    const { store, release } = slowStore();
    const { resolver, resolve } = makeHarness(true, { store, limiter });
    const first = resolver.attach(post("first"));
    const second = resolver.attach(post("second"));

    const onSightFirst: Promise<void> = first.lookupOnSight();
    const onSightSecond: Promise<void> = second.lookupOnSight();
    const hover: Promise<void> = first.lookup();
    release();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([onSightFirst, hover]);

    expect(resolve.mock.calls[0]?.[0]).toMatchObject({ handle: "first" });
    await vi.advanceTimersByTimeAsync(1000);
    await onSightSecond;
  });

  it("forgets a hover's promote request once that lookup has settled", async () => {
    vi.useFakeTimers();
    let now = 0;
    const limiter = new RateLimiter({ perMinute: 60, burst: 1 });
    const { resolver, resolve } = makeHarness(true, { limiter, cacheNow: () => now });
    const stale = resolver.attach(post("stale"));
    // The second hover finds the first still pending and asks to be promoted once queued.
    await Promise.all([stale.lookup(), stale.lookup()]);
    expect(resolve).toHaveBeenCalledTimes(1);

    // Memory and storage both forget the account, so the next on-sight lookup must queue.
    now = TIER2_CACHE_TTL_MS + 1;
    await fakeBrowser.storage.local.clear();
    limiter.tryAcquire();
    const onSightOther: Promise<void> = resolver.attach(post("other")).lookupOnSight();
    const onSightStale: Promise<void> = stale.lookupOnSight();
    await vi.advanceTimersByTimeAsync(1000);
    await onSightOther;

    expect(resolve.mock.calls[1]?.[0]).toMatchObject({ handle: "other" });
    await vi.advanceTimersByTimeAsync(1000);
    await onSightStale;
  });

  it("does not fetch when Tier 2 is switched off during the read, and settles the badge", async () => {
    const { store, release } = slowStore();
    const { resolver, resolve, setConfig } = makeHarness(true, { store });
    const handle = resolver.attach(post());

    const lookup: Promise<void> = handle.lookup();
    setConfig(false);
    release();
    await lookup;

    expect(resolve).not.toHaveBeenCalled();
    expect(handle.lookupStatus()).toBe("off");
  });

  it("reads pending while storage is read, and settled by the rescore a storage hit makes", async () => {
    const store = new PersistedLookupStore();
    await store.write("x", "someone", { followers: 99 });
    const read = store.read.bind(store);
    const waiting: Array<() => void> = [];
    vi.spyOn(store, "read").mockImplementation(
      (...args) => new Promise((resolve) => waiting.push(() => resolve(read(...args)))),
    );
    const { resolver, resolve } = makeHarness(true, { store });
    const handle = resolver.attach(post());
    const statusesHeard: string[] = [];
    handle.subscribe(() => statusesHeard.push(handle.lookupStatus()));

    const lookup: Promise<void> = handle.lookup();
    expect(handle.lookupStatus()).toBe("pending");
    waiting.splice(0).forEach((resume) => resume());
    await lookup;

    expect(resolve).not.toHaveBeenCalled();
    expect(statusesHeard.at(-1)).toBe("delivered");
    expect(handle.lookupStatus()).toBe("delivered");
  });

  it("reads pending through a storage miss and the fetch after it", async () => {
    const { store, release } = slowStore();
    const { resolver, resolve } = makeHarness(true, { store });
    const handle = resolver.attach(post());
    const statusesHeard: string[] = [];
    handle.subscribe(() => statusesHeard.push(handle.lookupStatus()));

    const lookup: Promise<void> = handle.lookup();
    expect(handle.lookupStatus()).toBe("pending");
    release();
    await lookup;

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(statusesHeard.at(-1)).toBe("delivered");
  });

  it("does not fetch when the resolver is disposed during the read", async () => {
    const { store, release } = slowStore();
    const { resolver, resolve } = makeHarness(true, { store });

    const lookup: Promise<void> = resolver.attach(post()).lookup();
    resolver.dispose();
    release();
    await lookup;

    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("AccountResolver memory refill from storage", () => {
  it("never keeps a stored snapshot in memory past its seven days", async () => {
    let clock = Date.UTC(2026, 9, 26);
    const store = new PersistedLookupStore(() => clock);
    await store.write("x", "someone", { followers: 99 });
    clock += LOOKUP_TTL_MS - 60_000;
    const { resolver, cache } = makeHarness(true, { store, cacheNow: () => clock });

    await resolver.attach(post()).lookup();

    expect(cache.has("someone")).toBe(true);
    clock += 59_000;
    expect(cache.has("someone")).toBe(true);
    clock += 2000;
    expect(cache.has("someone")).toBe(false);
  });
});

describe("a memory-only source behind a storage hit", () => {
  it("still runs on a hover, alone, and leaves the stored snapshot and the cache as they were", async () => {
    const store = new PersistedLookupStore();
    await store.write("bluesky", "someone", { followers: 99 });
    const profiles = vi.fn(async (): Promise<PartialSignals | null> => ({ followers: 12 }));
    const authorFeed = vi.fn(async (): Promise<PartialSignals | null> => ({
      postTimestamps: [Date.now() - 60_000],
    }));
    const sources: SignalSource[] = [
      { id: "profiles", platform: "bluesky", tier: 2, kind: "active", resolve: profiles },
      {
        id: "feed",
        platform: "bluesky",
        tier: 2,
        kind: "active",
        memoryOnly: true,
        resolve: authorFeed,
      },
    ];
    const cache = new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS);
    const resolver = new AccountResolver({
      adapter: {
        id: "bluesky",
        matches: () => true,
        observeFeed: () => () => undefined,
        extractDomSignals: () => ({}),
        sources,
        toFeatures: () => [],
        badgeDensity: "bluesky",
      },
      scorer,
      config: { ...config(true), platform: "bluesky" },
      limiter: new RateLimiter({ perMinute: 60, burst: 2 }),
      cache,
      persistence: { store, enabled: () => true },
    });
    const handle = resolver.attach({ ...post(), ref: { platform: "bluesky", handle: "someone" } });

    await handle.lookup();
    await handle.lookup();

    expect(profiles).not.toHaveBeenCalled();
    expect(authorFeed).toHaveBeenCalledTimes(1);
    expect(cache.get("someone")).toEqual({ followers: 99 });
    expect((await store.read("bluesky", "someone"))?.signals).toEqual({ followers: 99 });
    expect(handle.current().reasons.map((reason) => reason.text)).toContain("followers=99");
    resolver.dispose();
  });
});
