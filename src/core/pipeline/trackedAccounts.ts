/**
 * The resolver's per-tab account store: one entry per handle seen in the feed, holding its merged
 * signals, verdict, listeners and lookup state, with least-recently-touched eviction past a cap.
 */
import type { AccountRef, Verdict } from "../types";
import type { MergeableSignals } from "./mergeSignals";
import type { VerdictListener } from "./types";

/**
 * Ceiling on accounts tracked per tab. Passive sources emit for every author in every response, so
 * an endless feed would otherwise grow the map without bound; see `evictIdleEntries`.
 */
export const MAX_TRACKED_ACCOUNTS = 2000;
/** Evicting a batch at a time keeps the sort of idle entries off the hot path of every emission. */
const EVICTION_BATCH_SIZE = MAX_TRACKED_ACCOUNTS / 10;

export interface AccountEntry extends MergeableSignals {
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
  /** Value of the store's touch counter when the entry was last looked up; orders eviction. */
  touchedAt: number;
}

export class TrackedAccounts {
  private readonly entries = new Map<string, AccountEntry>();
  private touchCounter = 0;

  get size(): number {
    return this.entries.size;
  }

  /** The entry for a handle, if tracked; unlike `entryFor` it neither creates nor touches one. */
  get(handle: string): AccountEntry | undefined {
    return this.entries.get(handle);
  }

  values(): IterableIterator<AccountEntry> {
    return this.entries.values();
  }

  clear(): void {
    this.entries.clear();
  }

  /** The entry for an account, created on first sight; marks it as the most recently touched. */
  entryFor(ref: AccountRef): AccountEntry {
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
