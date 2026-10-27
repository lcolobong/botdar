/**
 * The active-source side of a Tier 2 lookup: which of an adapter's sources a lookup or a hover
 * runs, whether one is paused behind a login wall, and one call to a source with its failure
 * classified for the rate limiter.
 */
import type { TtlLruCache } from "../cache";
import type { RateLimiter } from "../ratelimit";
import { RateLimitedError } from "../ratelimit";
import type {
  AccountRef,
  AccountSignals,
  EffectivePlatformConfig,
  PartialSignals,
  PlatformAdapter,
  SignalSource,
  SourceTier,
} from "../types";
import type { LookupStorage } from "./lookupStorage";
import type { AccountEntry } from "./trackedAccounts";

/** What one call to a source came to: its signals, or how it failed. */
export interface SourceResult {
  partial: PartialSignals | null;
  failure: "rateLimited" | "failed" | null;
}

/** What a source call needs from the resolver; `config` is read when the call is made. */
export interface SourceCaller {
  limiter: RateLimiter;
  signal: AbortSignal;
  config: () => EffectivePlatformConfig;
}

/** What a lookup needs from the resolver; the getters read its state when called. */
export interface LookupContext extends SourceCaller {
  sources: LookupSourceSet;
  cache: TtlLruCache<string, PartialSignals>;
  storage: LookupStorage;
  disposed: () => boolean;
  /** Not disposed and Tier 2 on; the same gate the storage bridge reads. */
  lookupsLive: () => boolean;
  /** Merges a lookup's result (null: it found nothing) and rescores; `AccountResolver.absorb`. */
  absorb: (
    entry: AccountEntry,
    partial: PartialSignals | null,
    tier: SourceTier,
    alwaysRescore?: boolean,
  ) => void;
}

/** An active Tier 2 source a lookup or a hover can call. */
function isActiveTier2Source(source: SignalSource): boolean {
  return source.kind === "active" && source.tier === 2 && source.resolve !== undefined;
}

/**
 * The adapter's callable Tier 2 sources, split into the main lookup's and the hover-only ones.
 * The split is computed once per `adapter.sources` array, which is fixed for a resolver's lifetime
 * in production; an array swapped in later (tests do) is split again on the next read, as the
 * per-call filtering this replaces would have seen it.
 */
export class LookupSourceSet {
  private readonly adapter: PlatformAdapter;
  private splitFrom: SignalSource[] | undefined;
  private mainSources: SignalSource[] = [];
  private hoverOnlySources: SignalSource[] = [];

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
  }

  /** The Tier 2 sources a lookup runs on sight or hover; each call costs one limiter token. */
  main(): SignalSource[] {
    this.split();
    return this.mainSources;
  }

  hasMain(): boolean {
    return this.main().length > 0;
  }

  hoverOnly(): SignalSource[] {
    this.split();
    return this.hoverOnlySources;
  }

  /** The hover-only sources worth a request for this account, none while a login wall is up. */
  hoverSourcesToRun(signals: AccountSignals): SignalSource[] {
    if (this.needsLogin()) {
      return [];
    }
    return this.hoverOnly().filter((source) => source.worthResolving?.(signals) ?? true);
  }

  /** Whether any active source paused itself after a logged-out answer; asked on every call. */
  needsLogin(): boolean {
    return this.adapter.sources.some(
      (source) => source.kind === "active" && source.loginRequired?.() === true,
    );
  }

  private split(): void {
    const sources: SignalSource[] = this.adapter.sources;
    if (sources === this.splitFrom) {
      return;
    }
    const callable: SignalSource[] = sources.filter(isActiveTier2Source);
    this.mainSources = callable.filter((source) => source.hoverOnly !== true);
    this.hoverOnlySources = callable.filter((source) => source.hoverOnly === true);
    this.splitFrom = sources;
  }
}

/**
 * One call to a source, with its failure classified and the limiter told. The caller has paid for
 * the token (all up front for a lookup, one at a time for a hover) and decides what to cache.
 */
export async function resolveSource(
  caller: SourceCaller,
  ref: AccountRef,
  source: SignalSource,
): Promise<SourceResult> {
  try {
    const partial: PartialSignals | null | undefined = await source.resolve?.(ref, {
      signal: caller.signal,
      config: caller.config(),
    });
    caller.limiter.reportSuccess();
    return { partial: partial ?? null, failure: null };
  } catch (error) {
    if (error instanceof RateLimitedError) {
      caller.limiter.reportRateLimited(error.retryAfterMs);
      return { partial: null, failure: "rateLimited" };
    }
    return { partial: null, failure: "failed" };
  }
}
