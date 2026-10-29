/**
 * The AccountResolver pipeline (docs/architecture.md, "AccountResolver pipeline"): per-tab, in-memory
 * state for every account seen in the feed, fed by Tier 0 DOM extraction at attach time, Tier 1
 * passive sources as they emit, and Tier 2 active lookups on demand through the cache and the rate
 * limiter. The scoring engine and the effective config are injected so this module depends on
 * neither. Its parts live in src/core/pipeline/: the account store, the tier-merge rule, the main
 * and hover-only Tier 2 lookups, and the bridge to persisted lookups.
 */

import type {
  AccountRef,
  EffectivePlatformConfig,
  Feature,
  PartialSignals,
  PlatformAdapter,
  PostRef,
  SignalSource,
  SourceTier,
  Verdict,
} from "./types";
import { HoverLookups } from "./pipeline/hoverLookups";
import type { LookupContext } from "./pipeline/lookupSources";
import { LookupSourceSet } from "./pipeline/lookupSources";
import type { LookupStatusContext } from "./pipeline/lookupStatus";
import { lookupStatusOf } from "./pipeline/lookupStatus";
import { LookupStorage } from "./pipeline/lookupStorage";
import { MainLookups } from "./pipeline/mainLookups";
import { markDelivered, mergeSignals } from "./pipeline/mergeSignals";
import type { AccountEntry } from "./pipeline/trackedAccounts";
import { TrackedAccounts } from "./pipeline/trackedAccounts";
import type {
  AccountResolverOptions,
  BadgeHandle,
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
export type { MergeableSignals } from "./pipeline/mergeSignals";
export { mergeSignals } from "./pipeline/mergeSignals";
export { MAX_TRACKED_ACCOUNTS } from "./pipeline/trackedAccounts";
export { TIER2_CACHE_CAPACITY, TIER2_CACHE_TTL_MS } from "./pipeline/lookupStorage";

interface AttachedPost {
  entry: AccountEntry;
  handle: BadgeHandle;
  listeners: Set<VerdictListener>;
}

export class AccountResolver {
  private readonly adapter: PlatformAdapter;
  private readonly scorer: Scorer;
  private readonly lookupSources: LookupSourceSet;
  private readonly statusContext: LookupStatusContext;
  private readonly hoverLookups: HoverLookups;
  private readonly now: () => number;
  private readonly accounts = new TrackedAccounts();
  private readonly attachedPosts = new Map<Element, AttachedPost>();
  private readonly abortController = new AbortController();
  private readonly mainLookups: MainLookups;
  private stopPassiveSources: Array<() => void> = [];
  private readonly stopPageEvidence: () => void;
  private config: EffectivePlatformConfig;
  private disposed = false;

  constructor(options: AccountResolverOptions) {
    this.adapter = options.adapter;
    this.scorer = options.scorer;
    this.config = options.config;
    this.lookupSources = new LookupSourceSet(this.adapter);
    this.statusContext = {
      config: () => this.config,
      sources: this.lookupSources,
      isQueued: (handle) => this.mainLookups.isQueued(handle),
    };
    const lookupsLive: () => boolean = () => !this.disposed && this.config.tiers.t2;
    const storage: LookupStorage = new LookupStorage({
      persistence: options.persistence,
      adapter: this.adapter,
      cache: options.cache,
      lookupsLive,
    });
    const lookupContext: LookupContext = {
      limiter: options.limiter,
      signal: this.abortController.signal,
      config: () => this.config,
      sources: this.lookupSources,
      cache: options.cache,
      storage,
      disposed: () => this.disposed,
      lookupsLive,
      absorb: (entry, partial, tier, alwaysRescore) =>
        this.absorb(entry, partial, tier, alwaysRescore),
    };
    this.hoverLookups = new HoverLookups(lookupContext);
    this.now = options.now ?? Date.now;
    this.mainLookups = new MainLookups(lookupContext, this.accounts, this.now);
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
      const entry: AccountEntry | undefined = this.accounts.get(handle);
      if (!this.disposed && entry !== undefined && entry.posts.size > 0) {
        this.recompute(entry);
      }
    }
  }

  /** Accounts currently tracked in this tab; never exceeds `MAX_TRACKED_ACCOUNTS`. */
  get trackedAccountCount(): number {
    return this.accounts.size;
  }

  /** Runs Tier 0 now, merges Tier 1 data already received, scores, and returns the badge's handle. */
  attach(post: PostRef): BadgeHandle {
    const existing: AttachedPost | undefined = this.attachedPosts.get(post.element);
    if (existing !== undefined) {
      return existing.handle;
    }
    const entry: AccountEntry = this.accounts.entryFor(post.ref);
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
      lookupStatus: () => lookupStatusOf(entry, this.statusContext),
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
    const entry: AccountEntry = this.accounts.entryFor(ref);
    const mainLookupWasRunning: boolean = entry.pendingLookup !== null;
    const mainLookup: Promise<void> = this.mainLookups.request(entry);
    return this.hoverLookups.request(entry, mainLookup, mainLookupWasRunning);
  }

  /** The on-sight variant of `requestLookup` (ADR-0020): queued behind the limiter, once per account. */
  requestLookupOnSight(ref: AccountRef): Promise<void> {
    if (!this.config.tiers.t2 || this.disposed || !this.lookupSources.hasMain()) {
      return Promise.resolve();
    }
    return this.mainLookups.requestOnSight(this.accounts.entryFor(ref));
  }

  /** `config.changed`: rescore every mounted badge and start or stop passive sources to match. */
  updateConfig(config: EffectivePlatformConfig): void {
    this.config = config;
    if (!config.tiers.t2) {
      this.mainLookups.clearQueue();
    }
    this.stopPassive();
    this.startPassiveSources();
    for (const entry of this.accounts.values()) {
      if (entry.posts.size > 0) {
        this.recompute(entry);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.mainLookups.clearQueue();
    this.stopPassive();
    this.stopPageEvidence();
    this.abortController.abort();
    this.attachedPosts.clear();
    this.accounts.clear();
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
    this.absorb(this.accounts.entryFor(ref), partial, source.tier);
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
}
