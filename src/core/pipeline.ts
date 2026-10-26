/**
 * The AccountResolver pipeline (docs/architecture.md, "AccountResolver pipeline"): per-tab, in-memory
 * state for every account seen in the feed, fed by Tier 0 DOM extraction at attach time, Tier 1
 * passive sources as they emit, and Tier 2 active lookups on demand through the cache and the rate
 * limiter. The scoring engine and the effective config are injected so this module depends on
 * neither.
 */

import type { TtlLruCache } from "./cache";
import { LookupQueue } from "./lookupQueue";
import type { RateLimiter } from "./ratelimit";
import { recordLookup } from "./diagnostics.ts";
import { RateLimitedError } from "./ratelimit";
import type {
  AccountRef,
  AccountSignals,
  EffectivePlatformConfig,
  Feature,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  SignalField,
  SignalSource,
  SourceTier,
  Verdict,
} from "./types";

/** ADR-0012 ceiling for Tier 2 results held in memory; callers size their cache with it. */
export const TIER2_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Ceiling on accounts tracked per tab. Passive sources emit for every author in every response, so
 * an endless feed would otherwise grow the map without bound; see `evictIdleEntries`.
 */
export const MAX_TRACKED_ACCOUNTS = 2000;
/** Evicting a batch at a time keeps the sort of idle entries off the hot path of every emission. */
const EVICTION_BATCH_SIZE = MAX_TRACKED_ACCOUNTS / 10;

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

export interface AccountResolverOptions {
  adapter: PlatformAdapter;
  scorer: Scorer;
  config: EffectivePlatformConfig;
  limiter: RateLimiter;
  cache: TtlLruCache<string, PartialSignals>;
  now?: () => number;
}

export interface MergeableSignals {
  signals: AccountSignals;
  /** When each field was last observed, for the same-tier "newer wins" rule. */
  fieldObservedAt: Partial<Record<SignalField, number>>;
}

interface AccountEntry extends MergeableSignals {
  verdict: Verdict | null;
  listeners: Set<VerdictListener>;
  posts: Set<Element>;
  pendingLookup: Promise<void> | null;
  /**
   * Set while the active sources run and cleared before the closing rescore, so listeners already
   * see the settled status; `pendingLookup` is only cleared after that rescore.
   */
  lookupRunning: boolean;
  /** A source got a rate-limit token and ran for this account at least once. */
  lookupAttempted: boolean;
  /** Value of the resolver's touch counter when the entry was last looked up; orders eviction. */
  touchedAt: number;
}

interface AttachedPost {
  entry: AccountEntry;
  handle: BadgeHandle;
  listeners: Set<VerdictListener>;
}

const RESERVED_FIELDS: ReadonlySet<string> = new Set([
  "ref",
  "provenance",
  "tiersDelivered",
  "observedAt",
]);

/** Field values are primitives or one flat object (`replyShare`), so a shallow comparison is exact. */
function sameSignalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  const leftEntries: Array<[string, unknown]> = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => Object.is(value, (right as Record<string, unknown>)[key]))
  );
}

/** Records that a tier delivered data for the account; false when it was already recorded. */
function markDelivered(signals: AccountSignals, tier: SourceTier): boolean {
  if (signals.tiersDelivered.includes(tier)) {
    return false;
  }
  signals.tiersDelivered = [...signals.tiersDelivered, tier].sort();
  return true;
}

/**
 * Tier-merge rule: a higher tier overwrites a lower tier's value for the same field; within the same
 * tier the newer observation wins; a lower tier never overwrites. Returns whether a value or its
 * tier changed, which is all scoring reads: re-observing the same value only refreshes the times.
 */
export function mergeSignals(
  target: MergeableSignals,
  incoming: PartialSignals,
  tier: SourceTier,
  observedAt: number,
): boolean {
  let accepted = false;
  let changed = false;
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || RESERVED_FIELDS.has(key)) {
      continue;
    }
    const field = key as SignalField;
    const existingTier: SourceTier | undefined = target.signals.provenance[field];
    const existingObservedAt: number = target.fieldObservedAt[field] ?? 0;
    const outranked: boolean = existingTier !== undefined && tier < existingTier;
    const older: boolean = existingTier === tier && observedAt < existingObservedAt;
    if (outranked || older) {
      continue;
    }
    if (existingTier !== tier || !sameSignalValue(target.signals[field], value)) {
      changed = true;
    }
    Object.assign(target.signals, { [field]: value });
    target.signals.provenance[field] = tier;
    target.fieldObservedAt[field] = observedAt;
    accepted = true;
  }
  if (accepted) {
    target.signals.observedAt = Math.max(target.signals.observedAt, observedAt);
  }
  return changed;
}

export class AccountResolver {
  private readonly adapter: PlatformAdapter;
  private readonly scorer: Scorer;
  private readonly limiter: RateLimiter;
  private readonly cache: TtlLruCache<string, PartialSignals>;
  private readonly now: () => number;
  private readonly entries = new Map<string, AccountEntry>();
  private readonly attachedPosts = new Map<Element, AttachedPost>();
  private readonly abortController = new AbortController();
  private readonly onSightQueue: LookupQueue;
  private stopPassiveSources: Array<() => void> = [];
  private config: EffectivePlatformConfig;
  private disposed = false;
  private touchCounter = 0;

  constructor(options: AccountResolverOptions) {
    this.adapter = options.adapter;
    this.scorer = options.scorer;
    this.config = options.config;
    this.limiter = options.limiter;
    this.cache = options.cache;
    this.now = options.now ?? Date.now;
    this.onSightQueue = new LookupQueue({
      limiter: this.limiter,
      now: this.now,
      run: (handle) => this.runQueuedLookup(handle),
    });
    this.startPassiveSources();
  }

  /** Accounts currently tracked in this tab; never exceeds `MAX_TRACKED_ACCOUNTS`. */
  get trackedAccountCount(): number {
    return this.entries.size;
  }

  /** Runs Tier 0 now, merges Tier 1 data already received, scores, and returns the badge's handle. */
  attach(post: PostRef): BadgeHandle {
    const existing: AttachedPost | undefined = this.attachedPosts.get(post.element);
    if (existing !== undefined) {
      return existing.handle;
    }
    const entry: AccountEntry = this.entryFor(post.ref);
    entry.posts.add(post.element);
    mergeSignals(entry, this.adapter.extractDomSignals(post), 0, this.now());
    markDelivered(entry.signals, 0);
    this.recompute(entry);

    const listeners = new Set<VerdictListener>();
    const handle: BadgeHandle = {
      subscribe: (listener) => {
        listeners.add(listener);
        entry.listeners.add(listener);
        return () => {
          listeners.delete(listener);
          entry.listeners.delete(listener);
        };
      },
      current: () => entry.verdict ?? this.recompute(entry),
      lookup: () => this.requestLookup(post.ref),
      lookupOnSight: () => this.requestLookupOnSight(post.ref),
      lookupStatus: () => this.lookupStatusOf(entry),
    };
    this.attachedPosts.set(post.element, { entry, handle, listeners });
    return handle;
  }

  detach(post: PostRef): void {
    const attached: AttachedPost | undefined = this.attachedPosts.get(post.element);
    if (attached === undefined) {
      return;
    }
    this.attachedPosts.delete(post.element);
    attached.entry.posts.delete(post.element);
    for (const listener of attached.listeners) {
      attached.entry.listeners.delete(listener);
    }
  }

  /** Tier 2 through the cache, then the limiter; skipped (and left missing) while the circuit is open. */
  async requestLookup(ref: AccountRef): Promise<void> {
    if (!this.config.tiers.t2 || this.disposed) {
      return;
    }
    const entry: AccountEntry = this.entryFor(ref);
    if (entry.pendingLookup !== null) {
      this.onSightQueue.promote(ref.handle);
      return entry.pendingLookup;
    }
    const cached: PartialSignals | undefined = this.cache.get(ref.handle);
    if (cached !== undefined) {
      recordLookup("cached");
      this.absorb(entry, cached, 2);
      return;
    }
    recordLookup("started");
    this.trackPending(entry, this.runActiveSources(entry));
    return entry.pendingLookup ?? undefined;
  }

  /** The on-sight variant of `requestLookup` (ADR-0020): queued behind the limiter, once per account. */
  requestLookupOnSight(ref: AccountRef): Promise<void> {
    if (!this.config.tiers.t2 || this.disposed || !this.hasActiveLookupSource()) {
      return Promise.resolve();
    }
    const entry: AccountEntry = this.entryFor(ref);
    if (entry.pendingLookup !== null) {
      return entry.pendingLookup;
    }
    const alreadyTried: boolean = entry.lookupAttempted || entry.signals.tiersDelivered.includes(2);
    if (alreadyTried || this.activeSourceNeedsLogin()) {
      return Promise.resolve();
    }
    const cached: PartialSignals | undefined = this.cache.get(ref.handle);
    if (cached !== undefined) {
      recordLookup("cached");
      this.absorb(entry, cached, 2);
      return Promise.resolve();
    }
    this.trackPending(entry, this.onSightQueue.enqueue(ref.handle));
    return entry.pendingLookup ?? Promise.resolve();
  }

  private trackPending(entry: AccountEntry, lookup: Promise<unknown>): void {
    const pending: Promise<void> = lookup.then(
      () => undefined,
      () => undefined,
    );
    entry.pendingLookup = pending;
    void pending.then(() => {
      if (entry.pendingLookup === pending) {
        entry.pendingLookup = null;
      }
    });
  }

  /**
   * The queue's runner. An account whose posts all left, or whose lookups stopped making sense
   * (Tier 2 turned off, a login wall), is dropped as done; its badges hear the settled status.
   */
  private runQueuedLookup(handle: string): Promise<boolean> {
    const entry: AccountEntry | undefined = this.entries.get(handle);
    if (entry === undefined || this.disposed) {
      return Promise.resolve(true);
    }
    const stillWanted: boolean =
      this.config.tiers.t2 && entry.posts.size > 0 && this.hasActiveLookupSource();
    if (!stillWanted || this.activeSourceNeedsLogin()) {
      this.absorb(entry, null, 2);
      return Promise.resolve(true);
    }
    const cached: PartialSignals | undefined = this.cache.get(handle);
    if (cached !== undefined) {
      recordLookup("cached");
      this.absorb(entry, cached, 2, true);
      return Promise.resolve(true);
    }
    recordLookup("started");
    return this.runActiveSources(entry, { settleWhenTurnedAway: false });
  }

  private hasActiveLookupSource(): boolean {
    return this.adapter.sources.some(
      (source) => source.kind === "active" && source.tier === 2 && source.resolve !== undefined,
    );
  }

  private lookupStatusOf(entry: AccountEntry): LookupStatus {
    if (!this.config.tiers.t2) {
      return "off";
    }
    if (entry.lookupRunning || this.onSightQueue.has(entry.signals.ref.handle)) {
      return "pending";
    }
    if (entry.signals.tiersDelivered.includes(2)) {
      return "delivered";
    }
    if (this.activeSourceNeedsLogin()) {
      return "loginRequired";
    }
    return entry.lookupAttempted ? "empty" : "idle";
  }

  private activeSourceNeedsLogin(): boolean {
    return this.adapter.sources.some(
      (source) => source.kind === "active" && source.loginRequired?.() === true,
    );
  }

  /** `config.changed`: rescore every mounted badge and start or stop passive sources to match. */
  updateConfig(config: EffectivePlatformConfig): void {
    this.config = config;
    if (!config.tiers.t2) {
      this.onSightQueue.clear();
    }
    this.stopPassive();
    this.startPassiveSources();
    for (const entry of this.entries.values()) {
      if (entry.posts.size > 0) {
        this.recompute(entry);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.onSightQueue.clear();
    this.stopPassive();
    this.abortController.abort();
    this.attachedPosts.clear();
    this.entries.clear();
  }

  private startPassiveSources(): void {
    if (this.disposed) {
      return;
    }
    for (const source of this.adapter.sources) {
      if (
        source.kind !== "passive" ||
        source.start === undefined ||
        !this.tierEnabled(source.tier)
      ) {
        continue;
      }
      const stop: () => void = source.start((ref, partial) =>
        this.onPassiveEmission(source, ref, partial),
      );
      this.stopPassiveSources.push(stop);
    }
  }

  private stopPassive(): void {
    for (const stop of this.stopPassiveSources) {
      stop();
    }
    this.stopPassiveSources = [];
  }

  private tierEnabled(tier: SourceTier): boolean {
    switch (tier) {
      case 0:
        return true;
      case 1:
        return this.config.tiers.t1;
      case 2:
        return this.config.tiers.t2;
    }
  }

  private onPassiveEmission(source: SignalSource, ref: AccountRef, partial: PartialSignals): void {
    if (this.disposed || ref.platform !== this.adapter.id) {
      return;
    }
    this.absorb(this.entryFor(ref), partial, source.tier);
  }

  /**
   * Resolves whether any source ran; false when the limiter turned the whole lookup away. A hover
   * settles even then, so its card leaves the loading state; the queue does not
   * (`settleWhenTurnedAway: false`), because it will try again and the badge is still pending.
   */
  private async runActiveSources(
    entry: AccountEntry,
    { settleWhenTurnedAway }: { settleWhenTurnedAway: boolean } = { settleWhenTurnedAway: true },
  ): Promise<boolean> {
    const ref: AccountRef = entry.signals.ref;
    const collected: PartialSignals = {};
    let delivered = false;
    let outcome: "empty" | "rateLimited" | "failed" = "empty";
    let ran = false;
    entry.lookupRunning = true;
    for (const source of this.adapter.sources) {
      if (source.kind !== "active" || source.tier !== 2 || source.resolve === undefined) {
        continue;
      }
      // One token per platform call; an open circuit or an empty bucket skips the rest of the lookup.
      if (this.disposed || !this.limiter.tryAcquire()) {
        outcome = "rateLimited";
        break;
      }
      entry.lookupAttempted = true;
      ran = true;
      try {
        const partial: PartialSignals | null = await source.resolve(ref, {
          signal: this.abortController.signal,
          config: this.config,
        });
        this.limiter.reportSuccess();
        if (partial !== null) {
          Object.assign(collected, partial);
          delivered = true;
        }
      } catch (error) {
        if (error instanceof RateLimitedError) {
          this.limiter.reportRateLimited(error.retryAfterMs);
          outcome = "rateLimited";
        } else {
          outcome = "failed";
        }
      }
    }
    entry.lookupRunning = false;
    if (this.disposed) {
      return ran;
    }
    recordLookup(delivered ? "delivered" : outcome);
    if (!ran && !settleWhenTurnedAway) {
      return false;
    }
    if (delivered) {
      this.cache.set(ref.handle, collected);
    }
    // Rescore even when nothing arrived or nothing changed, so every badge of the account and a
    // waiting hover card leave their loading state.
    this.absorb(entry, delivered ? collected : null, 2, true);
    return ran;
  }

  /**
   * A relayed body repeats most of the accounts it carried last time, so an emission that changes
   * no field and adds no tier to an already-scored account skips the rescore and the badge renders
   * behind it. A null partial (a Tier 2 lookup that found nothing) and a finished lookup
   * (`alwaysRescore`) always rescore, because waiting badges and the hover card leave their loading
   * state on that notification.
   */
  private absorb(
    entry: AccountEntry,
    partial: PartialSignals | null,
    tier: SourceTier,
    alwaysRescore = false,
  ): void {
    if (partial !== null) {
      const changed: boolean = mergeSignals(entry, partial, tier, this.now());
      const newTier: boolean = markDelivered(entry.signals, tier);
      if (!changed && !newTier && entry.verdict !== null && !alwaysRescore) {
        return;
      }
    }
    if (entry.posts.size > 0) {
      this.recompute(entry);
    }
  }

  private recompute(entry: AccountEntry): Verdict {
    const features: Feature[] = this.adapter.toFeatures(entry.signals);
    const verdict: Verdict = this.scorer(features, entry.signals, entry.signals.tiersDelivered);
    entry.verdict = verdict;
    for (const listener of entry.listeners) {
      listener(verdict);
    }
    return verdict;
  }

  private entryFor(ref: AccountRef): AccountEntry {
    let entry: AccountEntry | undefined = this.entries.get(ref.handle);
    if (entry === undefined) {
      if (this.entries.size >= MAX_TRACKED_ACCOUNTS) {
        this.evictIdleEntries();
      }
      entry = {
        signals: { ref: { ...ref }, provenance: {}, tiersDelivered: [], observedAt: 0 },
        fieldObservedAt: {},
        verdict: null,
        listeners: new Set(),
        posts: new Set(),
        pendingLookup: null,
        lookupRunning: false,
        lookupAttempted: false,
        touchedAt: 0,
      };
      this.entries.set(ref.handle, entry);
    } else if (entry.signals.ref.id === undefined && ref.id !== undefined) {
      entry.signals.ref.id = ref.id;
    }
    entry.touchedAt = ++this.touchCounter;
    return entry;
  }

  /**
   * Drops the least recently touched accounts that have no post on screen, a batch at a time. An
   * entry with attached posts is never evicted, so a feed with more than the cap on screen at once
   * grows past it rather than losing badges.
   */
  private evictIdleEntries(): void {
    const idle: Array<[string, AccountEntry]> = [...this.entries].filter(
      ([, entry]) => entry.posts.size === 0,
    );
    idle.sort(([, left], [, right]) => left.touchedAt - right.touchedAt);
    const excess: number = this.entries.size - MAX_TRACKED_ACCOUNTS + EVICTION_BATCH_SIZE;
    for (const [handle] of idle.slice(0, excess)) {
      this.entries.delete(handle);
    }
  }
}
