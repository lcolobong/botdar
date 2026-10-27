/** Where an account's Tier 2 lookup stands (`LookupStatus`), read from its entry and the resolver. */
import type { EffectivePlatformConfig } from "../types";
import type { LookupSourceSet } from "./lookupSources";
import type { AccountEntry } from "./trackedAccounts";
import type { LookupStatus } from "./types";

/** Built once per resolver; every badge's status read shares it, and the getters read live state. */
export interface LookupStatusContext {
  config: () => EffectivePlatformConfig;
  sources: LookupSourceSet;
  /** Whether the account waits in the on-sight queue. */
  isQueued: (handle: string) => boolean;
}

export function lookupStatusOf(entry: AccountEntry, context: LookupStatusContext): LookupStatus {
  if (!context.config().tiers.t2) {
    return "off";
  }
  if (
    entry.lookupRunning ||
    entry.hoverLookupActive ||
    context.isQueued(entry.signals.ref.handle)
  ) {
    return "pending";
  }
  if (entry.signals.tiersDelivered.includes(2)) {
    return "delivered";
  }
  if (context.sources.needsLogin()) {
    return "loginRequired";
  }
  return entry.lookupAttempted ? "empty" : "idle";
}
