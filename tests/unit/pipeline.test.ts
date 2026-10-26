import { TtlLruCache } from "@/src/core/cache";
import { diagnosticsSnapshot, resetDiagnostics } from "@/src/core/diagnostics";
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
import { fakeReason, reasonTexts } from "../fakeReasons";

const ALL_TIERS: SourceTier[] = [0, 1, 2];

const fakeScorer: Scorer = (features, signals, sourcesAvailable) => ({
  tier: signals.declaredAutomated === true ? "declared" : features.length > 2 ? "many" : "typical",
  probability: 0.5,
  logOdds: 0,
  evidence: [],
  reasons: features.map((feature) => fakeReason(`${feature.id}@${feature.tier}`, feature.tier)),
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
  adapter: PlatformAdapter;
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
    adapter,
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

  it("reports no change when the same tier repeats a value, but refreshes its time", () => {
    const target = blankSignals();
    mergeSignals(target, { followers: 5, replyShare: { ratio: 0.5, sampleSize: 20 } }, 1, 100);
    expect(
      mergeSignals(target, { followers: 5, replyShare: { ratio: 0.5, sampleSize: 20 } }, 1, 200),
    ).toBe(false);
    expect(target.fieldObservedAt.followers).toBe(200);
    expect(target.signals.observedAt).toBe(200);
    expect(mergeSignals(target, { replyShare: { ratio: 0.6, sampleSize: 20 } }, 1, 300)).toBe(true);
  });

  it("reports a change when the same value arrives from a higher tier", () => {
    const target = blankSignals();
    mergeSignals(target, { followers: 5 }, 1, 100);
    expect(mergeSignals(target, { followers: 5 }, 2, 100)).toBe(true);
    expect(target.signals.provenance.followers).toBe(2);
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
    expect(reasonTexts(verdict)).toEqual(["displayName@0"]);
    expect(verdict.sourcesUsed).toEqual([0]);
    expect(verdict.sourcesMissing).toEqual([1, 2]);
  });

  it("merges Tier 1 data received before attach", () => {
    const { resolver, emit } = makeHarness();
    emit(ref(), { followers: 40, displayName: "API name" });
    const verdict: Verdict = resolver.attach(post()).current();
    expect(reasonTexts(verdict)).toEqual(expect.arrayContaining(["followers@1", "displayName@1"]));
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

  it("skips the rescore when a relayed body changes nothing for a scored account", () => {
    const { resolver, emit } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    emit(ref(), { followers: 40, declaredAutomated: true });
    const listener = vi.fn();
    handle.subscribe(listener);

    vi.advanceTimersByTime(500);
    emit(ref(), { followers: 40, declaredAutomated: true });
    expect(listener).not.toHaveBeenCalled();

    emit(ref(), { followers: 41 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(reasonTexts(handle.current())).toEqual(expect.arrayContaining(["followers@1"]));
  });

  it("rescores when an emission adds a tier even if it changes no field", () => {
    const { resolver, emit } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    const listener = vi.fn();
    handle.subscribe(listener);

    emit(ref(), {});

    expect(listener).toHaveBeenCalledTimes(1);
    expect(handle.current().sourcesUsed).toEqual([0, 1]);
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
    expect(reasonTexts(handle.current())).toEqual(expect.arrayContaining(["followers@2"]));
    expect(limiter.nextAllowedAt()).toBe(Date.now());
  });

  it("lets Tier 2 overwrite Tier 1 but not the other way round", async () => {
    const { resolver, emit } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    emit(ref(), { followers: 1 });
    await handle.lookup();
    emit(ref(), { followers: 2 });
    expect(reasonTexts(handle.current())).toContain("followers@2");
  });

  it("serves a cache hit without calling the source", async () => {
    const cache = new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS);
    cache.set("someone", { followers: 99 });
    const { resolver, resolve } = makeHarness({ t1: true, t2: true }, { cache });
    const handle: BadgeHandle = resolver.attach(post());

    await handle.lookup();

    expect(resolve).not.toHaveBeenCalled();
    expect(reasonTexts(handle.current())).toContain("followers@2");
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

  it("records every lookup outcome for the diagnostics panel", async () => {
    resetDiagnostics();
    const cache = new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS);
    const { resolver, resolve, limiter } = makeHarness({ t1: true, t2: true }, { cache });
    await resolver.attach(post()).lookup();
    cache.delete("someone");
    resolve.mockRejectedValueOnce(new Error("network"));
    await resolver.attach(post()).lookup();
    resolve.mockRejectedValueOnce(new RateLimitedError("429", 30_000));
    await resolver.attach(post()).lookup();
    await resolver.attach(post()).lookup();
    limiter.reportSuccess();
    vi.advanceTimersByTime(60_000);
    cache.set("someone", { followers: 99 });
    await resolver.attach(post()).lookup();
    expect(diagnosticsSnapshot().lookups).toEqual({
      started: 4,
      cached: 1,
      delivered: 1,
      empty: 0,
      rateLimited: 2,
      failed: 1,
    });
  });

  it("shares one in-flight lookup between concurrent requests", async () => {
    const { resolver, resolve } = makeHarness();
    const handle: BadgeHandle = resolver.attach(post());
    await Promise.all([handle.lookup(), handle.lookup(), resolver.requestLookup(ref())]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  describe("lookup status", () => {
    it("is idle before a lookup and pending while it runs, then delivered", async () => {
      const { resolver, resolve } = makeHarness();
      let finish: (partial: PartialSignals | null) => void = () => undefined;
      resolve.mockImplementationOnce(
        () => new Promise<PartialSignals | null>((resolvePartial) => (finish = resolvePartial)),
      );
      const handle: BadgeHandle = resolver.attach(post());
      const seen: string[] = [];
      handle.subscribe(() => seen.push(handle.lookupStatus()));
      expect(handle.lookupStatus()).toBe("idle");

      const lookup: Promise<void> = handle.lookup();
      expect(handle.lookupStatus()).toBe("pending");
      finish({ followers: 5 });
      await lookup;

      expect(handle.lookupStatus()).toBe("delivered");
      expect(seen).toEqual(["delivered"]);
    });

    it("is empty after a lookup that returned nothing, and the listener hears it", async () => {
      const { resolver, resolve } = makeHarness();
      resolve.mockResolvedValueOnce(null);
      const handle: BadgeHandle = resolver.attach(post());
      const listener = vi.fn();
      handle.subscribe(listener);
      await handle.lookup();
      expect(handle.lookupStatus()).toBe("empty");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("notifies on a finished lookup even when it changed nothing", async () => {
      const { resolver, cache } = makeHarness();
      const handle: BadgeHandle = resolver.attach(post());
      await handle.lookup();
      cache.clear();
      const listener = vi.fn();
      handle.subscribe(listener);
      await handle.lookup();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("stays idle when the limiter skipped the lookup", async () => {
      const { resolver, limiter } = makeHarness();
      limiter.reportRateLimited();
      const handle: BadgeHandle = resolver.attach(post());
      await handle.lookup();
      expect(handle.lookupStatus()).toBe("idle");
    });

    it("is off while Tier 2 is off", () => {
      const { resolver } = makeHarness({ t1: true, t2: false });
      expect(resolver.attach(post()).lookupStatus()).toBe("off");
    });

    it("reports a login wall from an active source unless the account already has data", async () => {
      const { resolver, adapter } = makeHarness();
      let loginRequired = false;
      const active: SignalSource | undefined = adapter.sources.find(
        (source) => source.kind === "active",
      );
      if (active === undefined) throw new Error("no active source");
      active.loginRequired = () => loginRequired;
      const handle: BadgeHandle = resolver.attach(post());
      const other: BadgeHandle = resolver.attach(post("other"));
      await handle.lookup();

      loginRequired = true;
      expect(handle.lookupStatus()).toBe("delivered");
      expect(other.lookupStatus()).toBe("loginRequired");
    });
  });

  describe("on-sight lookups", () => {
    it("looks each account up once, however many of its posts come into view", async () => {
      const { resolver, resolve } = makeHarness();
      const first: BadgeHandle = resolver.attach(post());
      const second: BadgeHandle = resolver.attach(post());
      await Promise.all([first.lookupOnSight(), second.lookupOnSight()]);
      await resolver.attach(post()).lookupOnSight();
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(first.lookupStatus()).toBe("delivered");
    });

    it("does not retry an account whose lookup returned nothing, but a hover still does", async () => {
      const { resolver, resolve } = makeHarness();
      resolve.mockResolvedValueOnce(null);
      const handle: BadgeHandle = resolver.attach(post());
      await handle.lookupOnSight();
      await resolver.attach(post()).lookupOnSight();
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(handle.lookupStatus()).toBe("empty");
      await handle.lookup();
      expect(resolve).toHaveBeenCalledTimes(2);
    });

    it("serves the cache without a request", async () => {
      const cache = new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS);
      cache.set("someone", { followers: 99 });
      const { resolver, resolve } = makeHarness({ t1: true, t2: true }, { cache });
      const handle: BadgeHandle = resolver.attach(post());
      await handle.lookupOnSight();
      expect(resolve).not.toHaveBeenCalled();
      expect(handle.lookupStatus()).toBe("delivered");
    });

    it("queues past the limiter's burst and stays pending until a token frees", async () => {
      const { resolver, resolve } = makeHarness();
      const handles: BadgeHandle[] = ["a", "b", "c"].map((handle) => resolver.attach(post(handle)));
      const lookups: Array<Promise<void>> = handles.map((handle) => handle.lookupOnSight());
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(handles[2]?.lookupStatus()).toBe("pending");

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all(lookups);
      expect(resolve).toHaveBeenCalledTimes(3);
      expect(handles[2]?.lookupStatus()).toBe("delivered");
    });

    it("lets a hover jump the queue", async () => {
      const { resolver, resolve } = makeHarness();
      const handles: BadgeHandle[] = ["a", "b", "c", "d"].map((handle) =>
        resolver.attach(post(handle)),
      );
      handles.forEach((handle) => void handle.lookupOnSight());
      void handles[3]?.lookup();
      await vi.advanceTimersByTimeAsync(1000);
      expect(resolve.mock.calls.map((call) => (call[0] as AccountRef).handle)).toEqual([
        "a",
        "b",
        "d",
      ]);
    });

    it("drops queued lookups when Tier 2 is turned off, and skips them while it is off", async () => {
      const { resolver, resolve } = makeHarness();
      const handles: BadgeHandle[] = ["a", "b", "c"].map((handle) => resolver.attach(post(handle)));
      const queued: Promise<void> = Promise.all(
        handles.map((handle) => handle.lookupOnSight()),
      ).then(() => undefined);
      resolver.updateConfig(config({ t1: true, t2: false }));
      await queued;
      await vi.advanceTimersByTimeAsync(5000);
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(handles[2]?.lookupStatus()).toBe("off");
      await resolver.attach(post("e")).lookupOnSight();
      expect(resolve).toHaveBeenCalledTimes(2);
    });

    it("skips accounts while an active source needs a login", async () => {
      const { resolver, resolve, adapter } = makeHarness();
      const active: SignalSource | undefined = adapter.sources.find(
        (source) => source.kind === "active",
      );
      if (active === undefined) throw new Error("no active source");
      active.loginRequired = () => true;
      const handle: BadgeHandle = resolver.attach(post());
      await handle.lookupOnSight();
      expect(resolve).not.toHaveBeenCalled();
      expect(handle.lookupStatus()).toBe("loginRequired");
    });

    it("counts on-sight lookups and cache hits for the diagnostics panel", async () => {
      resetDiagnostics();
      const cache = new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS);
      cache.set("cached", { followers: 99 });
      const { resolver } = makeHarness({ t1: true, t2: true }, { cache });
      await resolver.attach(post("cached")).lookupOnSight();
      await resolver.attach(post("fresh")).lookupOnSight();
      expect(diagnosticsSnapshot().lookups).toMatchObject({ started: 1, cached: 1, delivered: 1 });
    });

    it("does not spin when no active source can run the lookup", async () => {
      const { resolver, adapter } = makeHarness();
      adapter.sources = adapter.sources.filter((source) => source.kind !== "active");
      const handle: BadgeHandle = resolver.attach(post());
      const listener = vi.fn();
      handle.subscribe(listener);
      void handle.lookupOnSight();
      for (let tick = 0; tick < 200; tick += 1) await Promise.resolve();
      expect(listener.mock.calls.length).toBeLessThanOrEqual(1);
      expect(handle.lookupStatus()).not.toBe("pending");
    });

    it("keeps a lookup the limiter turned away pending and retries it after a pause", async () => {
      const { resolver, resolve, limiter } = makeHarness();
      vi.spyOn(limiter, "tryAcquire").mockReturnValueOnce(false);
      const handle: BadgeHandle = resolver.attach(post());
      const listener = vi.fn();
      handle.subscribe(listener);
      void handle.lookupOnSight();
      for (let tick = 0; tick < 200; tick += 1) await Promise.resolve();
      expect(resolve).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      expect(handle.lookupStatus()).toBe("pending");
      await vi.advanceTimersByTimeAsync(2000);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(handle.lookupStatus()).toBe("delivered");
    });

    it("drops a queued account whose posts all left", async () => {
      const { resolver, resolve } = makeHarness();
      ["a", "b"].forEach((handle) => void resolver.attach(post(handle)).lookupOnSight());
      const gone: PostRef = post("c");
      void resolver.attach(gone).lookupOnSight();
      resolver.detach(gone);
      await vi.advanceTimersByTimeAsync(5000);
      expect(resolve).toHaveBeenCalledTimes(2);
    });
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
