/**
 * An account's main Tier 2 lookup, every active source but the hover-only ones: on hover through
 * the memory cache, storage and the rate limiter, or on sight through the `LookupQueue` (ADR-0020),
 * at most once per account per page.
 */
import { recordLookup } from "../diagnostics";
import { LookupQueue } from "../lookupQueue";
import type { PersistedLookup } from "../persistedLookups";
import type { AccountRef, PartialSignals, SignalSource } from "../types";
import type { LookupContext, SourceResult } from "./lookupSources";
import { resolveSource } from "./lookupSources";
import type { AccountEntry, TrackedAccounts } from "./trackedAccounts";

interface ActiveRunOptions {
  settleWhenTurnedAway: boolean;
  /** The sources to run; every active Tier 2 source unless a storage hit answered for some. */
  sources?: SignalSource[];
  /** The run tops up a storage hit, so it is neither cached nor persisted. */
  topUp?: boolean;
}

export class MainLookups {
  private readonly context: LookupContext;
  private readonly accounts: TrackedAccounts;
  private readonly queue: LookupQueue;

  constructor(context: LookupContext, accounts: TrackedAccounts, now: () => number) {
    this.context = context;
    this.accounts = accounts;
    this.queue = new LookupQueue({
      // A queued lookup is ready only when every call it makes can be paid for.
      limiter: {
        nextAllowedAt: () => this.context.limiter.nextAllowedAt(this.context.sources.main().length),
      },
      now,
      run: (handle) => this.runQueuedLookup(handle),
    });
  }

  isQueued(handle: string): boolean {
    return this.queue.has(handle);
  }

  clearQueue(): void {
    this.queue.clear();
  }

  /** A hover's main lookup: memory, then storage, then the sources; joins one already pending. */
  request(entry: AccountEntry): Promise<void> {
    if (entry.pendingLookup !== null) {
      entry.promoteWhenQueued = true;
      this.queue.promote(entry.signals.ref.handle);
      return entry.pendingLookup;
    }
    if (this.settleFromMemory(entry, false)) {
      return Promise.resolve();
    }
    if (this.context.storage.active()) {
      return this.trackPending(entry, this.lookupPersistedThenFetch(entry));
    }
    recordLookup("started");
    return this.trackPending(entry, this.runActiveSources(entry));
  }

  /** `AccountResolver.requestLookupOnSight` for an account it has found worth a lookup. */
  requestOnSight(entry: AccountEntry): Promise<void> {
    if (entry.pendingLookup !== null) {
      return entry.pendingLookup;
    }
    const alreadyTried: boolean = entry.lookupAttempted || entry.signals.tiersDelivered.includes(2);
    if (alreadyTried || this.context.sources.needsLogin()) {
      return Promise.resolve();
    }
    if (this.settleFromMemory(entry, false)) {
      return Promise.resolve();
    }
    if (this.context.storage.active()) {
      return this.trackPending(entry, this.lookupPersistedThenQueue(entry));
    }
    return this.trackPending(entry, this.queue.enqueue(entry.signals.ref.handle));
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
      ? this.context.sources.main().filter((source) => source.memoryOnly === true)
      : this.context.sources.main();
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
    const queued: Promise<void> = this.queue.enqueue(handle);
    // A hover that arrived during the storage read could not move the key before it was queued.
    if (entry.promoteWhenQueued) {
      this.queue.promote(handle);
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
    if (this.context.disposed()) {
      return false;
    }
    if (!this.context.config().tiers.t2) {
      this.context.absorb(entry, null, 2);
      return false;
    }
    return true;
  }

  /**
   * A memory-cache hit settles the account without a call; false on a miss. `alwaysRescore` is the
   * queued path's: its badges wait on the closing notification even when nothing changed.
   */
  private settleFromMemory(entry: AccountEntry, alwaysRescore: boolean): boolean {
    const cached: PartialSignals | undefined = this.context.cache.get(entry.signals.ref.handle);
    if (cached === undefined) {
      return false;
    }
    recordLookup("cached");
    this.context.absorb(entry, cached, 2, alwaysRescore);
    return true;
  }

  private async settleFromPersisted(entry: AccountEntry): Promise<boolean> {
    const persisted: PersistedLookup | undefined = await this.context.storage.read(entry);
    if (persisted === undefined) {
      return false;
    }
    recordLookup("cached");
    this.context.absorb(entry, persisted.signals, 2, true);
    return true;
  }

  /** Records the lookup as the account's pending one and returns it, settled to undefined. */
  private trackPending(entry: AccountEntry, lookup: Promise<unknown>): Promise<void> {
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
    return pending;
  }

  /**
   * The queue's runner. An account whose posts all left, or whose lookups stopped making sense
   * (Tier 2 turned off, a login wall), is dropped as done; its badges hear the settled status.
   */
  private runQueuedLookup(handle: string): Promise<boolean> {
    const entry: AccountEntry | undefined = this.accounts.get(handle);
    if (entry === undefined || this.context.disposed()) {
      return Promise.resolve(true);
    }
    const stillWanted: boolean =
      this.context.config().tiers.t2 && entry.posts.size > 0 && this.context.sources.hasMain();
    if (!stillWanted || this.context.sources.needsLogin()) {
      this.context.absorb(entry, null, 2);
      return Promise.resolve(true);
    }
    if (this.settleFromMemory(entry, true)) {
      return Promise.resolve(true);
    }
    recordLookup("started");
    return this.runActiveSources(entry, { settleWhenTurnedAway: false });
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
      sources = this.context.sources.main(),
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
      sources.length > 0 &&
      !this.context.disposed() &&
      this.context.limiter.tryAcquire(sources.length);
    if (sources.length > 0 && !ran) {
      outcome = "rateLimited";
    }
    entry.lookupRunning = true;
    entry.lookupAttempted ||= ran;
    for (const source of ran ? sources : []) {
      const result: SourceResult = await resolveSource(this.context, ref, source);
      if (result.failure !== null) {
        outcome = result.failure;
      } else if (result.partial !== null) {
        Object.assign(collected, result.partial);
        delivered = true;
      }
    }
    entry.lookupRunning = false;
    if (this.context.disposed()) {
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
      this.context.cache.set(ref.handle, collected);
      this.context.storage.write(ref.handle, collected);
    }
    // Rescore even when nothing arrived or nothing changed, so every badge of the account and a
    // waiting hover card leave their loading state.
    this.context.absorb(entry, delivered ? collected : null, 2, true);
    return ran;
  }
}
