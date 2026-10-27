/**
 * Hover-only Tier 2 sources (`SignalSource.hoverOnly`): run when a badge is hovered, after the
 * account's main lookup has settled, each through its own cache entry, rate-limit token and outcome.
 */
import { recordLookup } from "../diagnostics";
import type { PersistedLookup } from "../persistedLookups";
import type { PartialSignals, SignalSource } from "../types";
import type { LookupContext, LookupSourceSet, SourceResult } from "./lookupSources";
import { resolveSource } from "./lookupSources";
import { hoverCacheKey } from "./lookupStorage";
import type { AccountEntry } from "./trackedAccounts";

export class HoverLookups {
  private readonly context: LookupContext;

  constructor(context: LookupContext) {
    this.context = context;
  }

  /**
   * Chains the hover-only sources behind the account's main lookup; at most one hover run per
   * account at a time. `mainLookupWasRunning`: the main lookup was pending before this hover.
   */
  request(
    entry: AccountEntry,
    mainLookup: Promise<void>,
    mainLookupWasRunning: boolean,
  ): Promise<void> {
    if (entry.hoverLookup !== null) {
      return entry.hoverLookup;
    }
    const sources: LookupSourceSet = this.context.sources;
    // A running main lookup has not delivered the join date the sources judge by, so their filter
    // waits for it; a settled one is judged now, and only once.
    const settledCandidates: SignalSource[] | undefined =
      entry.pendingLookup === null && !mainLookupWasRunning
        ? sources.hoverSourcesToRun(entry.signals)
        : undefined;
    const candidates: SignalSource[] = settledCandidates ?? sources.hoverOnly();
    if (candidates.length === 0) {
      return mainLookup;
    }
    entry.hoverLookupActive = candidates.some(
      (source) =>
        this.context.cache.get(hoverCacheKey(entry.signals.ref.handle, source)) === undefined,
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
      const sources: SignalSource[] =
        judgedSources ?? this.context.sources.hoverSourcesToRun(entry.signals);
      for (const source of sources) {
        if (!this.context.lookupsLive()) {
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
    if (this.context.disposed()) {
      return;
    }
    this.context.absorb(entry, delivered ? collected : null, 2, true);
  }

  private async resolveHoverSource(
    entry: AccountEntry,
    source: SignalSource,
  ): Promise<PartialSignals | null> {
    const { cache, storage, limiter }: LookupContext = this.context;
    const handle: string = entry.signals.ref.handle;
    const cacheKey: string = hoverCacheKey(handle, source);
    const cached: PartialSignals | undefined = cache.get(cacheKey);
    if (cached !== undefined) {
      recordLookup("cached");
      return cached;
    }
    if (storage.active()) {
      const persisted: PersistedLookup | undefined = await storage.read(entry, source);
      if (persisted !== undefined) {
        recordLookup("cached");
        return persisted.signals;
      }
      if (!this.context.lookupsLive()) {
        return null;
      }
    }
    if (!limiter.tryAcquire()) {
      recordLookup("rateLimited");
      return null;
    }
    recordLookup("started");
    const { partial, failure }: SourceResult = await resolveSource(
      this.context,
      entry.signals.ref,
      source,
    );
    if (failure !== null) {
      recordLookup(failure);
      return null;
    }
    if (partial === null || this.context.disposed()) {
      recordLookup("empty");
      return null;
    }
    recordLookup("delivered");
    cache.set(cacheKey, partial);
    storage.write(handle, partial, source);
    return partial;
  }
}
