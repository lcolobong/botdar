import { fakeBrowser } from "wxt/testing/fake-browser";
import { TtlLruCache } from "@/src/core/cache";
import { PersistedLookupStore } from "@/src/core/persistedLookups";
import { AccountResolver, TIER2_CACHE_TTL_MS } from "@/src/core/pipeline";
import type { Scorer } from "@/src/core/pipeline";
import { RateLimitedError, RateLimiter } from "@/src/core/ratelimit";
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

const OVERVIEW_SIGNALS: PartialSignals = { oldestItemAt: 1_700_000_000_000, visibleItemCount: 12 };
const HOUR_MS = 60 * 60 * 1000;

const scorer: Scorer = (_features, signals, sourcesAvailable) => ({
  tier: "typical",
  probability: 0.5,
  logOdds: 0,
  evidence: [],
  reasons: [fakeReason(`oldest=${signals.oldestItemAt ?? "none"}`, 2)],
  confidence: 0.5,
  caveat: "This can be wrong.",
  sourcesUsed: sourcesAvailable,
  sourcesMissing: [],
  lowConfidence: false,
  policyVersion: 1,
  computedAt: Date.now(),
});

const config = (t2: boolean): EffectivePlatformConfig => ({
  platform: "reddit",
  enabled: true,
  tiers: { t1: false, t2 },
  rateLimitPerMinute: 60,
  policyVersion: 1,
});

interface Harness {
  resolver: AccountResolver;
  mainResolve: ReturnType<typeof vi.fn>;
  hoverResolve: ReturnType<typeof vi.fn>;
  cache: TtlLruCache<string, PartialSignals>;
  store: PersistedLookupStore;
  limiter: RateLimiter;
  loginRequired: { value: boolean };
  worthResolving: { value: boolean };
}

function makeHarness(): Harness {
  const mainResolve = vi.fn(async (): Promise<PartialSignals | null> => ({
    createdAt: 1_000,
    linkKarma: 5,
  }));
  const hoverResolve = vi.fn(async (): Promise<PartialSignals | null> => OVERVIEW_SIGNALS);
  const loginRequired = { value: false };
  const worthResolving = { value: true };
  const main: SignalSource = {
    id: "reddit.aboutJson",
    platform: "reddit",
    tier: 2,
    kind: "active",
    resolve: mainResolve,
    loginRequired: () => loginRequired.value,
  };
  const hover: SignalSource = {
    id: "reddit.overviewJson",
    platform: "reddit",
    tier: 2,
    kind: "active",
    hoverOnly: true,
    worthResolving: () => worthResolving.value,
    resolve: hoverResolve,
  };
  const adapter: PlatformAdapter = {
    id: "reddit",
    matches: () => true,
    observeFeed: () => () => undefined,
    extractDomSignals: () => ({}),
    sources: [main, hover],
    toFeatures: (signals: AccountSignals) => (signals.oldestItemAt === undefined ? [] : []),
    badgeDensity: "reddit-post",
  };
  const cache = new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS);
  const store = new PersistedLookupStore();
  const limiter = new RateLimiter({ perMinute: 60, burst: 5 });
  const resolver = new AccountResolver({
    adapter,
    scorer,
    config: config(true),
    limiter,
    cache,
    persistence: { store, enabled: () => true },
  });
  return {
    resolver,
    mainResolve,
    hoverResolve,
    cache,
    store,
    limiter,
    loginRequired,
    worthResolving,
  };
}

const ref = (handle = "someone"): AccountRef => ({ platform: "reddit", handle });
const post = (handle = "someone"): PostRef => ({
  element: { handle } as unknown as Element,
  ref: ref(handle),
  anchor: {} as Element,
});

const readReason = (reasons: Array<{ text: string }>): string[] => reasons.map(({ text }) => text);

beforeEach(() => {
  fakeBrowser.reset();
});

describe("hover-only sources in the pipeline", () => {
  it("leaves a hover-only source out of the on-sight lookup", async () => {
    const { resolver, mainResolve, hoverResolve } = makeHarness();
    await resolver.attach(post()).lookupOnSight();
    expect(mainResolve).toHaveBeenCalledTimes(1);
    expect(hoverResolve).not.toHaveBeenCalled();
  });

  it("runs it after the main lookup on hover and scores what it returned", async () => {
    const { resolver, mainResolve, hoverResolve } = makeHarness();
    const handle = resolver.attach(post());
    await handle.lookup();
    expect(mainResolve).toHaveBeenCalledTimes(1);
    expect(hoverResolve).toHaveBeenCalledTimes(1);
    expect(readReason(handle.current().reasons)).toEqual([
      `oldest=${OVERVIEW_SIGNALS.oldestItemAt}`,
    ]);
    expect(handle.lookupStatus()).toBe("delivered");
  });

  it("runs it after an on-sight lookup already cached the main snapshot", async () => {
    const { resolver, mainResolve, hoverResolve } = makeHarness();
    const handle = resolver.attach(post());
    await handle.lookupOnSight();
    await handle.lookup();
    expect(mainResolve).toHaveBeenCalledTimes(1);
    expect(hoverResolve).toHaveBeenCalledTimes(1);
  });

  it("shows the account as pending while the hover request runs", async () => {
    const { resolver, hoverResolve } = makeHarness();
    let finish: (signals: PartialSignals) => void = () => undefined;
    hoverResolve.mockImplementationOnce(
      () => new Promise<PartialSignals>((resolve) => (finish = resolve)),
    );
    const handle = resolver.attach(post());
    await handle.lookupOnSight();
    const hovering: Promise<void> = handle.lookup();
    expect(handle.lookupStatus()).toBe("pending");
    await vi.waitFor(() => expect(hoverResolve).toHaveBeenCalled());
    finish(OVERVIEW_SIGNALS);
    await hovering;
    expect(handle.lookupStatus()).toBe("delivered");
  });

  it("shares one request between hovers that overlap", async () => {
    const { resolver, hoverResolve } = makeHarness();
    const handle = resolver.attach(post());
    await Promise.all([handle.lookup(), handle.lookup()]);
    expect(hoverResolve).toHaveBeenCalledTimes(1);
  });

  it("serves the next hover from memory", async () => {
    const { resolver, hoverResolve, cache } = makeHarness();
    const handle = resolver.attach(post());
    await handle.lookup();
    await handle.lookup();
    expect(hoverResolve).toHaveBeenCalledTimes(1);
    expect(cache.get("reddit.overviewJson:someone")).toEqual(OVERVIEW_SIGNALS);
    // The main snapshot stays apart from the hover-only one.
    expect(cache.get("someone")).toEqual({ createdAt: 1_000, linkKarma: 5 });
  });

  it("serves a new tab from storage and expires the stored copy after 24 hours", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_800_000_000_000);
      const first = makeHarness();
      await first.resolver.attach(post()).lookup();
      await vi.waitFor(async () =>
        expect(
          await first.store.read("reddit", "someone", {
            id: "reddit.overviewJson",
            ttlMs: TIER2_CACHE_TTL_MS,
          }),
        ).toBeDefined(),
      );

      const secondTab = makeHarness();
      await secondTab.resolver.attach(post()).lookup();
      expect(secondTab.hoverResolve).not.toHaveBeenCalled();

      vi.setSystemTime(1_800_000_000_000 + 25 * HOUR_MS);
      const afterADay = makeHarness();
      await afterADay.resolver.attach(post()).lookup();
      expect(afterADay.hoverResolve).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["nothing", async () => null],
    [
      "a failure",
      async () => {
        throw new TypeError("boom");
      },
    ],
    [
      "a rate limit",
      async () => {
        throw new RateLimitedError("slow down", 1_000);
      },
    ],
  ])("does not cache %s, so the next hover asks again", async (_label, outcome) => {
    const { resolver, hoverResolve, cache, store } = makeHarness();
    hoverResolve.mockImplementationOnce(outcome);
    const handle = resolver.attach(post());
    await handle.lookup();
    expect(cache.get("reddit.overviewJson:someone")).toBeUndefined();
    expect(
      await store.read("reddit", "someone", {
        id: "reddit.overviewJson",
        ttlMs: TIER2_CACHE_TTL_MS,
      }),
    ).toBeUndefined();
    expect(handle.lookupStatus()).not.toBe("pending");
  });

  it("leaves no account pending when the hover step itself breaks", async () => {
    const { resolver, cache } = makeHarness();
    vi.spyOn(cache, "set").mockImplementation(() => {
      throw new Error("cache broke");
    });
    const handle = resolver.attach(post());
    await handle.lookup().catch(() => undefined);
    expect(handle.lookupStatus()).not.toBe("pending");
  });

  it("asks again after a failure once the limiter allows it", async () => {
    const { resolver, hoverResolve } = makeHarness();
    hoverResolve.mockImplementationOnce(async () => {
      throw new TypeError("boom");
    });
    const handle = resolver.attach(post());
    await handle.lookup();
    await handle.lookup();
    expect(hoverResolve).toHaveBeenCalledTimes(2);
  });

  it("takes a limiter token and stays quiet when the limiter is open", async () => {
    const { resolver, hoverResolve, limiter } = makeHarness();
    const handle = resolver.attach(post());
    await handle.lookupOnSight();
    limiter.reportRateLimited(60_000);
    await handle.lookup();
    expect(hoverResolve).not.toHaveBeenCalled();
    expect(handle.lookupStatus()).not.toBe("pending");
  });

  it("trips the limiter when the platform rate-limits it", async () => {
    const { resolver, hoverResolve, limiter } = makeHarness();
    hoverResolve.mockImplementationOnce(async () => {
      throw new RateLimitedError("slow down", 30_000);
    });
    await resolver.attach(post()).lookup();
    expect(limiter.isOpen()).toBe(true);
  });

  it("is dropped with Tier 2, as the signed policy can restrict it", async () => {
    const { resolver, mainResolve, hoverResolve } = makeHarness();
    resolver.updateConfig(config(false));
    await resolver.attach(post()).lookup();
    expect(mainResolve).not.toHaveBeenCalled();
    expect(hoverResolve).not.toHaveBeenCalled();
  });

  it("is skipped when the source finds the answer unusable for this account", async () => {
    const { resolver, hoverResolve, worthResolving } = makeHarness();
    worthResolving.value = false;
    await resolver.attach(post()).lookup();
    expect(hoverResolve).not.toHaveBeenCalled();
  });

  it("is skipped behind a login wall", async () => {
    const { resolver, hoverResolve, loginRequired } = makeHarness();
    const handle = resolver.attach(post());
    await handle.lookupOnSight();
    loginRequired.value = true;
    await handle.lookup();
    expect(hoverResolve).not.toHaveBeenCalled();
  });
});
