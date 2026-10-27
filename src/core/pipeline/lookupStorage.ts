/**
 * The bridge from the resolver's memory cache to the on-device lookup store (ADR-0025): storage
 * reads that repopulate the memory cache and writes that nothing waits on, both switched off by
 * conservative mode and by the persistLookups setting.
 */
import type { TtlLruCache } from "../cache";
import type { LookupFacet, PersistedLookup } from "../persistedLookups";
import type { PartialSignals, PlatformAdapter, SignalSource } from "../types";
import type { AccountEntry } from "./trackedAccounts";
import type { LookupPersistence } from "./types";

/** ADR-0012 ceiling for Tier 2 results held in memory; callers size their cache with it. */
export const TIER2_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Reddit and Hacker News handles never contain ":", so a source id prefix cannot meet a plain handle. */
export function hoverCacheKey(handle: string, source: SignalSource): string {
  return `${source.id}:${handle}`;
}

export interface LookupStorageOptions {
  persistence: LookupPersistence | undefined;
  adapter: PlatformAdapter;
  cache: TtlLruCache<string, PartialSignals>;
  /** False once the resolver is disposed or while Tier 2 is off. */
  lookupsLive: () => boolean;
}

export class LookupStorage {
  private readonly persistence: LookupPersistence | undefined;
  private readonly adapter: PlatformAdapter;
  private readonly cache: TtlLruCache<string, PartialSignals>;
  private readonly lookupsLive: () => boolean;

  constructor(options: LookupStorageOptions) {
    this.persistence = options.persistence;
    this.adapter = options.adapter;
    this.cache = options.cache;
    this.lookupsLive = options.lookupsLive;
  }

  /** Conservative mode (Tier 2 off) and the persistLookups setting both switch storage reads and writes off. */
  active(): boolean {
    return this.activePersistence() !== undefined;
  }

  /** Memory first (the caller's miss), then storage; a storage hit repopulates the memory cache. */
  async read(entry: AccountEntry, source?: SignalSource): Promise<PersistedLookup | undefined> {
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
      if (persisted === undefined || !this.active()) {
        return undefined;
      }
      // The memory copy must not outlive the stored one's expiry, whatever its age.
      this.cache.set(
        source === undefined ? handle : hoverCacheKey(handle, source),
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

  write(handle: string, signals: PartialSignals, source?: SignalSource): void {
    const persistence: LookupPersistence | undefined = this.activePersistence();
    if (persistence === undefined) {
      return;
    }
    // A failed write only means the next lookup is a fetch; nothing waits on it.
    void persistence.store
      .write(
        this.adapter.id,
        handle,
        signals,
        source === undefined ? undefined : this.facetOf(source),
      )
      .catch(() => undefined);
  }

  /** The persistence layer while storage is active, else undefined: one read gates and narrows. */
  private activePersistence(): LookupPersistence | undefined {
    const persistence: LookupPersistence | undefined = this.persistence;
    return persistence !== undefined && this.lookupsLive() && persistence.enabled()
      ? persistence
      : undefined;
  }

  private facetOf(source: SignalSource): LookupFacet {
    return { id: source.id, ttlMs: TIER2_CACHE_TTL_MS };
  }
}
