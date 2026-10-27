/**
 * The AccountResolver pipeline (docs/architecture.md, "AccountResolver pipeline"): per-tab, in-memory
 * state for every account seen in the feed, fed by Tier 0 DOM extraction at attach time, Tier 1
 * passive sources as they emit, and Tier 2 active lookups on demand through the cache and the rate
 * limiter. The scoring engine and the effective config are injected so this module depends on
 * neither.
 */

import type { TtlLruCache } from "./cache";
import { LookupQueue } from "./lookupQueue";
import type { LookupFacet, PersistedLookup } from "./persistedLookups";
import type { RateLimiter } from "./ratelimit";
import { recordLookup } from "./diagnostics.ts";
import { RateLimitedError } from "./ratelimit";
import { normalisePostTimestamps } from "./scoring/cadence";
import { MAX_POST_TEXT_LENGTH } from "./types";
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
import type {
  AccountResolverOptions,
  BadgeHandle,
  LookupPersistence,
  LookupStatus,
  Scorer,
  VerdictListener,
} from "./pipeline/types";

export type {
  AccountResolverOptions,
  BadgeHandle,
  LookupPersistence,
  LookupStatus,
  Scorer,
  VerdictListener,
} from "./pipeline/types";

/** ADR-0012 ceiling for Tier 2 results held in memory; callers size their cache with it. */
export const TIER2_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Ceiling on accounts tracked per tab. Passive sources emit for every author in every response, so
 * an endless feed would otherwise grow the map without bound; see `evictIdleEntries`.
 */
export const MAX_TRACKED_ACCOUNTS = 2000;
/** Evicting a batch at a time keeps the sort of idle entries off the hot path of every emission. */
const EVICTION_BATCH_SIZE = MAX_TRACKED_ACCOUNTS / 10;

interface ActiveRunOptions {
  settleWhenTurnedAway: boolean;
  /** The sources to run; every active Tier 2 source unless a storage hit answered for some. */
  sources?: SignalSource[];
  /** The run tops up a storage hit, so it is neither cached nor persisted. */
  topUp?: boolean;
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
  /**
   * Set from a hover that will run hover-only sources until they have settled, cleared before the
   * closing rescore like `lookupRunning`; one hover run at a time per account.
   */
  hoverLookupActive: boolean;
  hoverLookup: Promise<void> | null;
  /** Set by a hover while the on-sight lookup is still reading storage, before it can be queued. */
  promoteWhenQueued: boolean;
  /** Value of the resolver's touch counter when the entry was last looked up; orders eviction. */
  touchedAt: number;
}

/** What one call to a source came to: its signals, or how it failed. */
interface SourceResult {
  partial: PartialSignals | null;
  failure: "rateLimited" | "failed" | null;
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

/**
 * Field values are primitives, one flat object (`replyShare`) or one array of numbers
 * (`postTimestamps`), so a shallow comparison is exact.
 */
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
 * Post text gathers instead of being replaced within a tier: each response carries a few of an
 * author's posts, and a later body with one short reply must not wipe a profile page's sample and
 * flip the language read. New text is appended, unless the sample already holds it, up to the cap;
 * a higher tier's text replaces a lower tier's, as for every field.
 */
function gatheredPostText(existing: string | undefined, incoming: string): string {
  if (existing === undefined || existing.includes(incoming)) {
    return existing ?? incoming.slice(0, MAX_POST_TEXT_LENGTH);
  }
  return `${existing}\n${incoming}`.slice(0, MAX_POST_TEXT_LENGTH);
}

/**
 * Post timestamps follow the tier-merge rule with one difference: within a tier they add up instead
 * of the newer observation winning, because a profile timeline arrives a page at a time. A higher
 * tier's set replaces a lower tier's (Tier 1 bodies are page-controlled, a Tier 2 lookup is not),
 * and a lower tier never adds to a higher one, so the provenance is always the tier whose set is in
 * use. The result is normalised once here; the cadence statistics trust it. Returns whether the
 * set was taken and whether it changed.
 */
function mergePostTimestamps(
  target: MergeableSignals,
  incoming: number[],
  tier: SourceTier,
  observedAt: number,
): { accepted: boolean; changed: boolean } {
  const existingTier: SourceTier | undefined = target.signals.provenance.postTimestamps;
  if (existingTier !== undefined && tier < existingTier) {
    return { accepted: false, changed: false };
  }
  const base: number[] = existingTier === tier ? (target.signals.postTimestamps ?? []) : [];
  const merged: number[] = normalisePostTimestamps([...base, ...incoming], observedAt);
  const changed: boolean =
    existingTier !== tier || !sameSignalValue(target.signals.postTimestamps, merged);
  target.signals.postTimestamps = merged;
  target.signals.provenance.postTimestamps = tier;
  target.fieldObservedAt.postTimestamps = Math.max(
    target.fieldObservedAt.postTimestamps ?? 0,
    observedAt,
  );
  return { accepted: true, changed };
}

/**
 * Tier-merge rule: a higher tier overwrites a lower tier's value for the same field; within the same
 * tier the newer observation wins (post text gathers, `gatheredPostText`); a lower tier never
 * overwrites. Post timestamps accumulate within a tier too (`mergePostTimestamps`). Returns whether a
 * value or its tier changed, which is all scoring reads: re-observing the same value only refreshes
 * the times.
 */
export function mergeSignals(
  target: MergeableSignals,
  incoming: PartialSignals,
  tier: SourceTier,
  observedAt: number,
): boolean {
  const { postTimestamps, ...replacing } = incoming;
  const timestamps: { accepted: boolean; changed: boolean } =
    postTimestamps === undefined
      ? { accepted: false, changed: false }
      : mergePostTimestamps(target, postTimestamps, tier, observedAt);
  let accepted: boolean = timestamps.accepted;
  let changed: boolean = timestamps.changed;
  for (const [key, observed] of Object.entries(replacing)) {
    if (observed === undefined || RESERVED_FIELDS.has(key)) {
      continue;
    }
    const field = key as SignalField;
    const existingTier: SourceTier | undefined = target.signals.provenance[field];
    const existingObservedAt: number = target.fieldObservedAt[field] ?? 0;
    const outranked: boolean = existingTier !== undefined && tier < existingTier;
    const gathers: boolean = field === "postText" && existingTier === tier;
    const older: boolean = existingTier === tier && observedAt < existingObservedAt;
    if (outranked || (older && !gathers)) {
      continue;
    }
    const value: unknown =
      gathers && typeof observed === "string"
        ? gatheredPostText(target.signals.postText, observed)
        : observed;
    if (existingTier !== tier || !sameSignalValue(target.signals[field], value)) {
      changed = true;
    }
    Object.assign(target.signals, { [field]: value });
    target.signals.provenance[field] = tier;
    target.fieldObservedAt[field] = gathers ? Math.max(existingObservedAt, observedAt) : observedAt;
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
  private readonly persistence: LookupPersistence | undefined;
  private readonly now: () => number;
  private readonly entries = new Map<string, AccountEntry>();
  private readonly attachedPosts = new Map<Element, AttachedPost>();
  private readonly abortController = new AbortController();
  private readonly onSightQueue: LookupQueue;
  private stopPassiveSources: Array<() => void> = [];
  private readonly stopPageEvidence: () => void;
  private config: EffectivePlatformConfig;
  private disposed = false;
  private touchCounter = 0;

  constructor(options: AccountResolverOptions) {
    this.adapter = options.adapter;
    this.scorer = options.scorer;
    this.config = options.config;
    this.limiter = options.limiter;
    this.cache = options.cache;
    this.persistence = options.persistence;
    this.now = options.now ?? Date.now;
    this.onSightQueue = new LookupQueue({
      // A queued lookup is ready only when every call it makes can be paid for.
      limiter: {
        nextAllowedAt: () => this.limiter.nextAllowedAt(this.activeLookupSources().length),
      },
      now: this.now,
      run: (handle) => this.runQueuedLookup(handle),
    });
    this.startPassiveSources();
    this.stopPageEvidence =
      this.adapter.onEvidenceChanged?.((handles) => this.rescorePageEvidence(handles)) ??
      (() => undefined);
  }

  /**
   * Page evidence (a copy of an account's reply found further down the thread) changed for these
   * accounts after they were scored; only accounts with a post on screen are worth a rescore.
   */
  private rescorePageEvidence(handles: readonly string[]): void {
    for (const handle of handles) {
      const entry: AccountEntry | undefined = this.entries.get(handle);
      if (!this.disposed && entry !== undefined && entry.posts.size > 0) {
        this.recompute(entry);
      }
    }
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

  /**
   * Tier 2 through the cache, then the limiter; skipped (and left missing) while the circuit is
   * open. Hover-only sources run after the account's main lookup has settled.
   */
  async requestLookup(ref: AccountRef): Promise<void> {
    if (!this.config.tiers.t2 || this.disposed) {
      return;
    }
    const entry: AccountEntry = this.entryFor(ref);
    const mainLookupWasRunning: boolean = entry.pendingLookup !== null;
    const mainLookup: Promise<void> = this.requestMainLookup(entry);
    if (entry.hoverLookup !== null) {
      return entry.hoverLookup;
    }
    // A running main lookup has not delivered the join date the sources judge by, so their filter
    // waits for it; a settled one is judged now, and only once.
    const settledCandidates: SignalSource[] | undefined =
      entry.pendingLookup === null && !mainLookupWasRunning
        ? this.hoverSourcesToRun(entry)
        : undefined;
    const anyWanted: boolean = (settledCandidates ?? this.hoverOnlySources()).length > 0;
    if (!anyWanted) {
      return mainLookup;
    }
    entry.hoverLookupActive = (settledCandidates ?? this.hoverOnlySources()).some(
      (source) => this.cache.get(this.hoverCacheKey(ref.handle, source)) === undefined,
    );
    const hoverLookup: Promise<void> = mainLookup.then(() =>
      this.runHoverSources(entry, settledCandidates),
    );
    entry.hoverLookup = hoverLookup;
    void hoverLookup.then(
      () => this.finishHoverLookup(entry, hoverLookup),
      () => this.finishHoverLookup(entry, hoverLookup),
    );
    return hoverLookup;
  }

  private finishHoverLookup(entry: AccountEntry, hoverLookup: Promise<void>): void {
    // The hover body clears this before its closing rescore; a chain that never reached it (the main
    // lookup rejected) or threw would otherwise leave the account pending for good.
    entry.hoverLookupActive = false;
    if (entry.hoverLookup === hoverLookup) {
      entry.hoverLookup = null;
    }
  }

  private requestMainLookup(entry: AccountEntry): Promise<void> {
    if (entry.pendingLookup !== null) {
      entry.promoteWhenQueued = true;
      this.onSightQueue.promote(entry.signals.ref.handle);
      return entry.pendingLookup;
    }
    const cached: PartialSignals | undefined = this.cache.get(entry.signals.ref.handle);
    if (cached !== undefined) {
      recordLookup("cached");
      this.absorb(entry, cached, 2);
      return Promise.resolve();
    }
    if (this.persistenceActive()) {
      this.trackPending(entry, this.lookupPersistedThenFetch(entry));
      return entry.pendingLookup ?? Promise.resolve();
    }
    recordLookup("started");
    this.trackPending(entry, this.runActiveSources(entry));
    return entry.pendingLookup ?? Promise.resolve();
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
    if (this.persistenceActive()) {
      this.trackPending(entry, this.lookupPersistedThenQueue(entry));
      return entry.pendingLookup ?? Promise.resolve();
    }
    this.trackPending(entry, this.onSightQueue.enqueue(ref.handle));
    return entry.pendingLookup ?? Promise.resolve();
  }

  /**
   * Memory missed: a storage hit settles the account without a call to the sources it answers for;
   * a source whose fields storage never holds (`memoryOnly`, the Bluesky author feed) still runs,
   * for its fields alone. A miss fetches everything.
   */
  private async lookupPersistedThenFetch(entry: AccountEntry): Promise<void> {
    const settled: boolean = await this.settleFromPersisted(entry);
    if (!this.stillWorthFetching(entry)) {
      return;
    }
    const sources: SignalSource[] = settled
      ? this.activeLookupSources().filter((source) => source.memoryOnly === true)
      : this.activeLookupSources();
    if (sources.length === 0) {
      return;
    }
    recordLookup("started");
    await this.runActiveSources(entry, { settleWhenTurnedAway: true, sources, topUp: settled });
  }

  /** The on-sight variant: a storage hit skips the queue, so it does not wait for a rate-limit token. */
  private async lookupPersistedThenQueue(entry: AccountEntry): Promise<void> {
    if ((await this.settleFromPersisted(entry)) || !this.stillWorthFetching(entry)) {
      return;
    }
    const handle: string = entry.signals.ref.handle;
    const queued: Promise<void> = this.onSightQueue.enqueue(handle);
    // A hover that arrived during the storage read could not move the key before it was queued.
    if (entry.promoteWhenQueued) {
      this.onSightQueue.promote(handle);
    }
    entry.promoteWhenQueued = false;
    await queued;
  }

  /**
   * The storage read is asynchronous, so Tier 2 may have been switched off or the resolver disposed
   * meanwhile. A lookup turned away that way settles the account (waiting badges leave "Checking")
   * without a fetch, as the queued path does.
   */
  private stillWorthFetching(entry: AccountEntry): boolean {
    if (this.disposed) {
      return false;
    }
    if (!this.config.tiers.t2) {
      this.absorb(entry, null, 2);
      return false;
    }
    return true;
  }

  private async settleFromPersisted(entry: AccountEntry): Promise<boolean> {
    const persisted: PersistedLookup | undefined = await this.readPersisted(entry);
    if (persisted === undefined) {
      return false;
    }
    recordLookup("cached");
    this.absorb(entry, persisted.signals, 2, true);
    return true;
  }

  /** Memory first (the caller's miss), then storage; a storage hit repopulates the memory cache. */
  private async readPersisted(
    entry: AccountEntry,
    source?: SignalSource,
  ): Promise<PersistedLookup | undefined> {
    const persistence: LookupPersistence | undefined = this.persistence;
    if (persistence === undefined) {
      return undefined;
    }
    const handle: string = entry.signals.ref.handle;
    // A facet read runs beside the main lookup, whose own read owns this flag.
    const ownsRunningFlag: boolean = source === undefined;
    if (ownsRunningFlag) {
      entry.lookupRunning = true;
    }
    try {
      const persisted: PersistedLookup | undefined = await persistence.store.read(
        this.adapter.id,
        handle,
        source === undefined ? undefined : this.facetOf(source),
      );
      if (persisted === undefined || !this.persistenceActive()) {
        return undefined;
      }
      // The memory copy must not outlive the stored one's expiry, whatever its age.
      this.cache.set(
        source === undefined ? handle : this.hoverCacheKey(handle, source),
        persisted.signals,
        Math.min(TIER2_CACHE_TTL_MS, persisted.remainingMs),
      );
      return persisted;
    } catch {
      return undefined;
    } finally {
      if (ownsRunningFlag) {
        entry.lookupRunning = false;
      }
    }
  }

  /** Conservative mode (Tier 2 off) and the persistLookups setting both switch storage reads and writes off. */
  private persistenceActive(): boolean {
    return (
      this.persistence !== undefined &&
      !this.disposed &&
      this.config.tiers.t2 &&
      this.persistence.enabled()
    );
  }

  private persist(handle: string, signals: PartialSignals, source?: SignalSource): void {
    if (this.persistence === undefined || !this.persistenceActive()) {
      return;
    }
    // A failed write only means the next lookup is a fetch; nothing waits on it.
    void this.persistence.store
      .write(
        this.adapter.id,
        handle,
        signals,
        source === undefined ? undefined : this.facetOf(source),
      )
      .catch(() => undefined);
  }

  private facetOf(source: SignalSource): LookupFacet {
    return { id: source.id, ttlMs: TIER2_CACHE_TTL_MS };
  }

  /** Reddit and Hacker News handles never contain ":", so a source id prefix cannot meet a plain handle. */
  private hoverCacheKey(handle: string, source: SignalSource): string {
    return `${source.id}:${handle}`;
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
      // A hover's promote request is only meant for the lookup that was pending when it arrived.
      entry.promoteWhenQueued = false;
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
    return this.activeLookupSources().length > 0;
  }

  /** The Tier 2 sources a lookup runs on sight or hover; each call costs one limiter token. */
  private activeLookupSources(): SignalSource[] {
    return this.adapter.sources.filter(
      (source) =>
        source.kind === "active" &&
        source.tier === 2 &&
        source.resolve !== undefined &&
        source.hoverOnly !== true,
    );
  }

  private hoverOnlySources(): SignalSource[] {
    return this.adapter.sources.filter(
      (source) =>
        source.kind === "active" &&
        source.tier === 2 &&
        source.resolve !== undefined &&
        source.hoverOnly === true,
    );
  }

  /** The hover-only sources worth a request for this account, none while a login wall is up. */
  private hoverSourcesToRun(entry: AccountEntry): SignalSource[] {
    if (this.activeSourceNeedsLogin()) {
      return [];
    }
    return this.hoverOnlySources().filter(
      (source) => source.worthResolving?.(entry.signals) ?? true,
    );
  }

  /**
   * One call to a source, with its failure classified and the limiter told. The caller has paid for
   * the token (all up front for a lookup, one at a time for a hover) and decides what to cache.
   */
  private async resolveSource(ref: AccountRef, source: SignalSource): Promise<SourceResult> {
    try {
      const partial: PartialSignals | null | undefined = await source.resolve?.(ref, {
        signal: this.abortController.signal,
        config: this.config,
      });
      this.limiter.reportSuccess();
      return { partial: partial ?? null, failure: null };
    } catch (error) {
      if (error instanceof RateLimitedError) {
        this.limiter.reportRateLimited(error.retryAfterMs);
        return { partial: null, failure: "rateLimited" };
      }
      return { partial: null, failure: "failed" };
    }
  }

  /**
   * Hover-only sources settle one by one, each through its own cache entry, token and outcome: they
   * are not part of the account's main snapshot, so a lookup missing one is still whole. What
   * arrived scores in a single closing rescore, which also ends the loading state.
   */
  private async runHoverSources(
    entry: AccountEntry,
    judgedSources?: SignalSource[],
  ): Promise<void> {
    const collected: PartialSignals = {};
    let delivered = false;
    try {
      for (const source of judgedSources ?? this.hoverSourcesToRun(entry)) {
        if (this.disposed || !this.config.tiers.t2) {
          break;
        }
        const partial: PartialSignals | null = await this.resolveHoverSource(entry, source);
        if (partial !== null) {
          Object.assign(collected, partial);
          delivered = true;
        }
      }
    } finally {
      // Cleared before the closing rescore, so the badge sees the settled status in it.
      entry.hoverLookupActive = false;
    }
    if (this.disposed) {
      return;
    }
    this.absorb(entry, delivered ? collected : null, 2, true);
  }

  private async resolveHoverSource(
    entry: AccountEntry,
    source: SignalSource,
  ): Promise<PartialSignals | null> {
    const handle: string = entry.signals.ref.handle;
    const cacheKey: string = this.hoverCacheKey(handle, source);
    const cached: PartialSignals | undefined = this.cache.get(cacheKey);
    if (cached !== undefined) {
      recordLookup("cached");
      return cached;
    }
    if (this.persistenceActive()) {
      const persisted: PersistedLookup | undefined = await this.readPersisted(entry, source);
      if (persisted !== undefined) {
        recordLookup("cached");
        return persisted.signals;
      }
      if (this.disposed || !this.config.tiers.t2) {
        return null;
      }
    }
    if (!this.limiter.tryAcquire()) {
      recordLookup("rateLimited");
      return null;
    }
    recordLookup("started");
    const { partial, failure }: SourceResult = await this.resolveSource(entry.signals.ref, source);
    if (failure !== null) {
      recordLookup(failure);
      return null;
    }
    if (partial === null || this.disposed) {
      recordLookup("empty");
      return null;
    }
    recordLookup("delivered");
    this.cache.set(cacheKey, partial);
    this.persist(handle, partial, source);
    return partial;
  }

  private lookupStatusOf(entry: AccountEntry): LookupStatus {
    if (!this.config.tiers.t2) {
      return "off";
    }
    if (
      entry.lookupRunning ||
      entry.hoverLookupActive ||
      this.onSightQueue.has(entry.signals.ref.handle)
    ) {
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
    this.stopPageEvidence();
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
    {
      settleWhenTurnedAway,
      sources = this.activeLookupSources(),
      topUp = false,
    }: ActiveRunOptions = { settleWhenTurnedAway: true },
  ): Promise<boolean> {
    const ref: AccountRef = entry.signals.ref;
    const collected: PartialSignals = {};
    let delivered = false;
    let outcome: "empty" | "rateLimited" | "failed" = "empty";
    // One token per platform call, all taken up front: a lookup that got only some of its calls
    // would be cached as if whole and hide the missing source's fields for the cache's lifetime.
    const ran: boolean =
      sources.length > 0 && !this.disposed && this.limiter.tryAcquire(sources.length);
    if (sources.length > 0 && !ran) {
      outcome = "rateLimited";
    }
    entry.lookupRunning = true;
    entry.lookupAttempted ||= ran;
    for (const source of ran ? sources : []) {
      const result: SourceResult = await this.resolveSource(ref, source);
      if (result.failure !== null) {
        outcome = result.failure;
      } else if (result.partial !== null) {
        Object.assign(collected, result.partial);
        delivered = true;
      }
    }
    entry.lookupRunning = false;
    if (this.disposed) {
      return ran;
    }
    // A lookup where any call failed is not whole: what arrived still scores, but it is neither
    // cached nor recorded as delivered, so the next hover asks again.
    const whole: boolean = outcome === "empty";
    recordLookup(delivered && whole ? "delivered" : outcome);
    if (!ran && !settleWhenTurnedAway) {
      return false;
    }
    // A top-up after a storage hit leaves the cached snapshot as it is: its memory copy keeps the
    // stored entry's expiry, and the topped-up fields live on the account for this tab.
    if (delivered && whole && !topUp) {
      this.cache.set(ref.handle, collected);
      this.persist(ref.handle, collected);
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
        hoverLookupActive: false,
        hoverLookup: null,
        promoteWhenQueued: false,
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
