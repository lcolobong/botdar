import { TtlLruCache } from "@/src/core/cache";
import type { BadgeHandle, Scorer } from "@/src/core/pipeline";
import { AccountResolver, TIER2_CACHE_TTL_MS } from "@/src/core/pipeline";
import { RateLimiter } from "@/src/core/ratelimit";
import type {
  AccountSignals,
  Feature,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  Verdict,
} from "@/src/core/types";
import { fakeReason } from "../../fakeReasons";

type EvidenceListener = (handles: readonly string[]) => void;

/** Page evidence the fake adapter's toFeatures reads, as the thread index would supply it. */
const copiedReplies = new Map<string, number>();
let listeners: EvidenceListener[] = [];

const scorer: Scorer = (features, _signals, sourcesAvailable) => ({
  tier: "typical",
  probability: 0.1,
  logOdds: -2,
  evidence: [],
  reasons: features.map((feature) => fakeReason(`${feature.id}=${String(feature.value)}`, 0)),
  confidence: 1,
  caveat: "",
  sourcesUsed: sourcesAvailable,
  sourcesMissing: [],
  lowConfidence: false,
  policyVersion: 1,
  computedAt: 0,
});

const adapter: PlatformAdapter = {
  id: "reddit",
  matches: () => true,
  observeFeed: () => () => undefined,
  extractDomSignals: () => ({}),
  sources: [],
  toFeatures: (signals: AccountSignals): Feature[] => {
    const count: number | undefined = copiedReplies.get(signals.ref.handle);
    return count === undefined
      ? []
      : [{ id: "thread.nearDuplicateReply", value: count, group: "coordination", tier: 0 }];
  },
  onEvidenceChanged: (listener) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((existing) => existing !== listener);
    };
  },
  badgeDensity: "reddit-comment",
};

function makeResolver(): AccountResolver {
  return new AccountResolver({
    adapter,
    scorer,
    config: {
      platform: "reddit",
      enabled: true,
      tiers: { t1: false, t2: false },
      rateLimitPerMinute: 30,
      policyVersion: 1,
    },
    limiter: new RateLimiter({ perMinute: 30, burst: 1 }),
    cache: new TtlLruCache<string, PartialSignals>(10, TIER2_CACHE_TTL_MS),
  });
}

function postBy(handle: string): PostRef {
  return {
    element: { handle } as unknown as Element,
    ref: { platform: "reddit", handle },
    anchor: {} as Element,
  };
}

function reasonOf(verdict: Verdict): string | undefined {
  return verdict.reasons[0]?.text;
}

beforeEach(() => {
  copiedReplies.clear();
  listeners = [];
});

describe("AccountResolver page evidence", () => {
  it("rescores an account on screen when its page evidence changes", () => {
    const resolver: AccountResolver = makeResolver();
    copiedReplies.set("copier", 0);
    const handle: BadgeHandle = resolver.attach(postBy("copier"));
    const heard: Verdict[] = [];
    handle.subscribe((verdict) => heard.push(verdict));

    copiedReplies.set("copier", 2);
    for (const listener of listeners) listener(["copier"]);

    expect(heard.map(reasonOf)).toEqual(["thread.nearDuplicateReply=2"]);
    expect(reasonOf(handle.current())).toBe("thread.nearDuplicateReply=2");
  });

  it("leaves accounts with no post on screen alone", () => {
    const resolver: AccountResolver = makeResolver();
    const post: PostRef = postBy("gone");
    const handle: BadgeHandle = resolver.attach(post);
    const listener = vi.fn();
    handle.subscribe(listener);
    resolver.detach(post);

    for (const evidenceListener of listeners) evidenceListener(["gone", "never-seen"]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops listening when disposed", () => {
    const resolver: AccountResolver = makeResolver();
    expect(listeners).toHaveLength(1);
    resolver.dispose();
    expect(listeners).toHaveLength(0);
  });
});
