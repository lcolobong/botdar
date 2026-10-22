import { TtlLruCache } from "@/src/core/cache";
import type { BadgeHandle, MergeableSignals, Scorer } from "@/src/core/pipeline";
import {
  AccountResolver,
  MAX_TRACKED_ACCOUNTS,
  TIER2_CACHE_TTL_MS,
  mergeSignals,
} from "@/src/core/pipeline";
import { RateLimitedError, RateLimiter } from "@/src/core/ratelimit";
import type {
  AccountRef,
  AccountSignals,
  EffectivePlatformConfig,
  Feature,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  SignalEmitter,
  SignalField,
  SignalSource,
  SourceTier,
  Verdict,
} from "@/src/core/types";

const ALL_TIERS: SourceTier[] = [0, 1, 2];

const fakeScorer: Scorer = (features, signals, sourcesAvailable) => ({
  tier: signals.declaredAutomated === true ? "declared" : features.length > 2 ? "many" : "typical",
  probability: 0.5,
  logOdds: 0,
  evidence: [],
  reasons: features.map((feature) => `${feature.id}@${feature.tier}`),
  confidence: sourcesAvailable.length / ALL_TIERS.length,
  caveat: "This can be wrong.",
  sourcesUsed: sourcesAvailable,
  sourcesMissing: ALL_TIERS.filter((tier) => !sourcesAvailable.includes(tier)),
  lowConfidence: sourcesAvailable.length < 2,
  policyVersion: 1,
  computedAt: Date.now(),
});

const toFeatures = (signals: AccountSignals): Feature[] =>
  (Object.keys(signals.provenance) as SignalField[]).map((field) => ({
    id: field,
    value: typeof signals[field] === "number" ? (signals[field] as number) : true,
    group: "profile",
    tier: signals.provenance[field] ?? 0,
  }));

const config = (tiers: { t1: boolean; t2: boolean }): EffectivePlatformConfig => ({
  platform: "x",
  enabled: true,
  tiers,
  rateLimitPerMinute: 60,
  policyVersion: 1,
});

interface Harness {
  resolver: AccountResolver;
  emit: SignalEmitter;
  resolve: ReturnType<typeof vi.fn>;
  stopPassive: ReturnType<typeof vi.fn>;
  limiter: RateLimiter;
  cache: TtlLruCache<string, PartialSignals>;
  extractDomSignals: ReturnType<typeof vi.fn>;
}

const makeHarness = (
  tiers: { t1: boolean; t2: boolean } = { t1: true, t2: true },
  options: { cache?: TtlLruCache<string, PartialSignals> } = {},
): Harness => {
  let emit: SignalEmitter = () => undefined;
  const stopPassive = vi.fn(() => {
    emit = () => undefined;
  });
  const resolve = vi.fn(async (): Promise<PartialSignals | null> => ({
    followers: 12,
    postCount: 3,
  }));
  const extractDomSignals = vi.fn((): PartialSignals => ({ displayName: "DOM name" }));
  const passive: SignalSource = {
    id: "x.graphql",
    platform: "x",
    tier: 1,
    kind: "passive",
    start: (emitter) => {
      emit = emitter;
      return stopPassive;
    },
  };
  const active: SignalSource = { id: "x.about", platform: "x", tier: 2, kind: "active", resolve };
  const adapter: PlatformAdapter = {
    id: "x",
    matches: () => true,
    observeFeed: () => () => undefined,
    extractDomSignals,
    sources: [passive, active],
    toFeatures,
    badgeDensity: "x",
  };
  const limiter = new RateLimiter({ perMinute: 60, burst: 2 });
  const cache: TtlLruCache<string, PartialSignals> =
    options.cache ?? new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS);
  const resolver = new AccountResolver({
    adapter,
    scorer: fakeScorer,
    config: config(tiers),
    limiter,
    cache,
  });
  return {
    resolver,
    emit: (ref, partial) => emit(ref, partial),
    resolve,
    stopPassive,
    limiter,
    cache,
    extractDomSignals,
  };
};

const ref = (handle = "someone"): AccountRef => ({ platform: "x", handle });

const post = (handle = "someone"): PostRef => ({
  element: { handle } as unknown as Element,
  ref: ref(handle),
  anchor: {} as Element,
});

const blankSignals = (): MergeableSignals => ({
  signals: { ref: ref(), provenance: {}, observedAt: 0 },
  fieldObservedAt: {},
});

describe("mergeSignals", () => {
  it("records the tier per field and the newest observation time", () => {
    const target = blankSignals();
    expect(mergeSignals(target, { followers: 5, bio: "hi" }, 1, 100)).toBe(true);
    expect(target.signals.followers).toBe(5);
    expect(target.signals.provenance).toEqual({ followers: 1, bio: 1 });
    expect(target.signals.observedAt).toBe(100);
  });

  it("lets a higher tier overwrite a lower tier", () => {
    const target = blankSignals();
    mergeSignals(target, { followers: 5 }, 0, 100);
    mergeSignals(target, { followers: 9 }, 2, 50);
    expect(target.signals.followers).toBe(9);
    expect(target.signals.provenance.followers).toBe(2);
  });

  it("never lets a lower tier overwrite a higher tier", () => {
    const target = blankSignals();
    mergeSignals(target, { followers: 9 }, 2, 100);
    expect(mergeSignals(target, { followers: 5 }, 1, 200)).toBe(false);
    expect(target.signals.followers).toBe(9);
    expect(target.signals.observedAt).toBe(100);
  });

  it("lets a newer same-tier observation win and ignores an older one", () => {
    const target = blankSignals();
    mergeSignals(target, { followers: 5 }, 1, 100);
    mergeSignals(target, { followers: 7 }, 1, 150);
    expect(target.signals.followers).toBe(7);
    expect(mergeSignals(target, { followers: 1 }, 1, 120)).toBe(false);
    expect(target.signals.followers).toBe(7);
  });

  it("skips undefined values and reserved keys", () => {
    const target = blankSignals();
    const hostile = { followers: undefined, ref: { platform: "x", handle: "evil" }, observedAt: 9 };
    expect(mergeSignals(target, hostile as unknown as PartialSignals, 2, 100)).toBe(false);
    expect(target.signals.ref.handle).toBe("someone");
    expect(target.signals.observedAt).toBe(0);
  });
});

describe("AccountResolver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scores Tier 0 immediately on attach", () => {
    const { resolver, extractDomSignals } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    const verdict: Verdict = handle.current();
    expect(extractDomSignals).toHaveBeenCalledTimes(1);
    expect(verdict.reasons).toEqual(["displayName@0"]);
    expect(verdict.sourcesUsed).toEqual([0]);
    expect(verdict.sourcesMissing).toEqual([1, 2]);
  });

  it("merges Tier 1 data received before attach", () => {
    const { resolver, emit } = makeHarness();
    emit(ref(), { followers: 40, displayName: "API name" });
    const verdict: Verdict = resolver.attach(post()).current();
    expect(verdict.reasons).toEqual(expect.arrayContaining(["followers@1", "displayName@1"]));
    expect(verdict.sourcesUsed).toEqual([0, 1]);
  });

  it("rescores and notifies listeners when Tier 1 data arrives after attach", () => {
    const { resolver, emit } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    const listener = vi.fn();
    handle.subscribe(listener);
    emit(ref(), { declaredAutomated: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(handle.current().tier).toBe("declared");
  });

  it("ignores emissions for another platform", () => {
    const { resolver, emit } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    emit({ platform: "reddit", handle: "someone" }, { followers: 1 });
    expect(handle.current().sourcesUsed).toEqual([0]);
  });

  it("does not start passive sources or run lookups when their tiers are off", async () => {
    const { resolver, resolve, stopPassive, emit } = makeHarness({ t1: false, t2: false });
    const handle: BadgeHandle = resolver.attach(post());
    emit(ref(), { followers: 1 });
    await handle.lookup();
    expect(resolve).not.toHaveBeenCalled();
    expect(handle.current().sourcesUsed).toEqual([0]);
    resolver.dispose();
    expect(stopPassive).not.toHaveBeenCalled();
  });

  it("runs Tier 2 through the limiter and cache and rescores", async () => {
    const { resolver, resolve, cache, limiter } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    const listener = vi.fn();
    handle.subscribe(listener);

    await handle.lookup();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]?.[1]).toMatchObject({ config: config({ t1: true, t2: true }) });
    expect(cache.get("someone")).toEqual({ followers: 12, postCount: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(handle.current().sourcesUsed).toEqual([0, 2]);
    expect(handle.current().reasons).toEqual(expect.arrayContaining(["followers@2"]));
    expect(limiter.nextAllowedAt()).toBe(Date.now());
  });

  it("lets Tier 2 overwrite Tier 1 but not the other way round", async () => {
    const { resolver, emit } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    emit(ref(), { followers: 1 });
    await handle.lookup();
    emit(ref(), { followers: 2 });
    expect(handle.current().reasons).toContain("followers@2");
  });

  it("serves a cache hit without calling the source", async () => {
    const cache = new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS);
    cache.set("someone", { followers: 99 });
    const { resolver, resolve } = makeHarness({ t1: true, t2: true }, { cache });
    const handle: BadgeHandle = resolver.attach(post());

    await handle.lookup();

    expect(resolve).not.toHaveBeenCalled();
    expect(handle.current().reasons).toContain("followers@2");
    expect(handle.current().sourcesUsed).toEqual([0, 2]);
  });

  it("skips the lookup and leaves Tier 2 missing while the circuit is open", async () => {
    const { resolver, resolve, limiter } = makeHarness();
    limiter.reportRateLimited();
    const handle: BadgeHandle = resolver.attach(post());
    const listener = vi.fn();
    handle.subscribe(listener);

    await handle.lookup();

    expect(resolve).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(handle.current().sourcesMissing).toContain(2);
  });

  it("opens the circuit when a source reports a rate limit", async () => {
    const { resolver, resolve, limiter, cache } = makeHarness();
    resolve.mockRejectedValueOnce(new RateLimitedError("429", 30_000));
    const handle: BadgeHandle = resolver.attach(post());

    await handle.lookup();

    expect(limiter.isOpen()).toBe(true);
    expect(limiter.nextAllowedAt()).toBe(Date.now() + 30_000);
    expect(cache.has("someone")).toBe(false);
    expect(handle.current().sourcesMissing).toContain(2);
  });

  it("swallows other source failures and does not cache them", async () => {
    const { resolver, resolve, cache, limiter } = makeHarness();
    resolve.mockRejectedValueOnce(new Error("network"));
    const handle: BadgeHandle = resolver.attach(post());
    await expect(handle.lookup()).resolves.toBeUndefined();
    expect(cache.has("someone")).toBe(false);
    expect(limiter.isOpen()).toBe(false);
  });

  it("shares one in-flight lookup between concurrent requests", async () => {
    const { resolver, resolve } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    await Promise.all([handle.lookup(), handle.lookup(), resolver.requestLookup(ref())]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("never runs a lookup on attach; Tier 2 waits for hover", async () => {
    const { resolver, resolve } = makeHarness();
    resolver.attach(post());
    await vi.runAllTimersAsync();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("bounds the account map under a flood of passive emissions, keeping attached accounts", () => {
    const { resolver, emit } = makeHarness();
    const mounted: BadgeHandle = resolver.attach(post("mounted"));
    for (let index = 0; index < 5000; index += 1) {
      emit(ref(`flood${index}`), { followers: index });
    }

    expect(resolver.trackedAccountCount).toBeLessThanOrEqual(MAX_TRACKED_ACCOUNTS);
    expect(resolver.trackedAccountCount).toBeGreaterThan(MAX_TRACKED_ACCOUNTS / 2);
    emit(ref("mounted"), { declaredAutomated: true });
    expect(mounted.current().tier).toBe("declared");
    // The newest emissions survive; the oldest idle handles are the ones evicted.
    emit(ref("flood4999"), { declaredAutomated: true });
    expect(resolver.attach(post("flood4999")).current().tier).toBe("declared");
    expect(resolver.attach(post("flood0")).current().sourcesUsed).toEqual([0]);
  });

  it("returns the same handle for a post attached twice", () => {
    const { resolver, extractDomSignals } = makeHarness();
    const samePost: PostRef = post();
    const first: BadgeHandle = resolver.attach(samePost);
    const second: BadgeHandle = resolver.attach(samePost);
    expect(second).toBe(first);
    expect(extractDomSignals).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a detached post while keeping the account's signals", () => {
    const { resolver, emit } = makeHarness();
    const detached: PostRef = post();
    const handle: BadgeHandle = resolver.attach(detached);
    const listener = vi.fn();
    handle.subscribe(listener);
    resolver.detach(detached);

    emit(ref(), { followers: 3 });
    expect(listener).not.toHaveBeenCalled();

    const remounted: BadgeHandle = resolver.attach(post());
    expect(remounted.current().sourcesUsed).toEqual([0, 1]);
  });

  it("rescores every mounted badge on a config change and stops passive sources when t1 goes off", () => {
    const { resolver, stopPassive, emit } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    const listener = vi.fn();
    handle.subscribe(listener);

    resolver.updateConfig(config({ t1: false, t2: true }));

    expect(stopPassive).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    emit(ref(), { followers: 3 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops passive sources, aborts lookups and ignores late results on dispose", async () => {
    const { resolver, resolve, stopPassive, cache } = makeHarness();
    let abortSignal: AbortSignal | undefined;
    resolve.mockImplementationOnce(async (_ref: AccountRef, context: { signal: AbortSignal }) => {
      abortSignal = context.signal;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
      return { followers: 1 };
    });
    const handle: BadgeHandle = resolver.attach(post());
    const pending: Promise<void> = handle.lookup();

    resolver.dispose();
    await vi.runAllTimersAsync();
    await pending;

    expect(stopPassive).toHaveBeenCalledTimes(1);
    expect(abortSignal?.aborted).toBe(true);
    expect(cache.has("someone")).toBe(false);
    await expect(resolver.requestLookup(ref())).resolves.toBeUndefined();
  });
});
