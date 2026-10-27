/**
 * The AccountResolver's public contracts (src/core/pipeline.ts): the scorer and storage a platform's
 * wiring injects, and the handle each badge holds.
 */
import type { TtlLruCache } from "../cache";
import type { PersistedLookupStore } from "../persistedLookups";
import type { RateLimiter } from "../ratelimit";
import type {
  AccountSignals,
  EffectivePlatformConfig,
  Feature,
  PartialSignals,
  PlatformAdapter,
  SourceTier,
  Verdict,
} from "../types";

export type Scorer = (
  features: Feature[],
  signals: AccountSignals,
  sourcesAvailable: SourceTier[],
) => Verdict;

export type VerdictListener = (verdict: Verdict) => void;

/**
 * Where an account's Tier 2 lookup stands, for the badge's loading state and the No read card.
 * `off`: the effective config has no Tier 2. `pending`: a lookup is queued or running.
 * `delivered`: one returned data. `loginRequired`: an active source paused itself after a
 * logged-out answer. `empty`: a lookup ran and returned nothing. `idle`: none has run for this
 * account yet.
 */
export type LookupStatus = "off" | "idle" | "pending" | "delivered" | "empty" | "loginRequired";

export interface BadgeHandle {
  subscribe: (listener: VerdictListener) => () => void;
  current: () => Verdict;
  /** Runs the Tier 2 lookup now (hover), ahead of any queued on-sight lookup; resolves after rescoring. */
  lookup: () => Promise<void>;
  /**
   * Queues the Tier 2 lookup when the post comes into view: at most one attempt per account per
   * page, and none while a source needs a login. Resolves after rescoring, or at once when skipped.
   */
  lookupOnSight: () => Promise<void>;
  lookupStatus: () => LookupStatus;
}

/** The on-device layer under the memory cache (ADR-0025); `enabled` is the user's persistLookups setting. */
export interface LookupPersistence {
  store: PersistedLookupStore;
  enabled: () => boolean;
}

export interface AccountResolverOptions {
  adapter: PlatformAdapter;
  scorer: Scorer;
  config: EffectivePlatformConfig;
  limiter: RateLimiter;
  cache: TtlLruCache<string, PartialSignals>;
  persistence?: LookupPersistence;
  now?: () => number;
}
