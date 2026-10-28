/** The contracts of the shared on-sight wiring (src/platforms/onSightWire.ts) and its badge slot. */
import type { BadgeHandle, Scorer } from "@/src/core/pipeline";
import type { PlatformWeights } from "@/src/core/scoring/types";
import type { Settings } from "@/src/core/settings";
import type {
  EffectivePlatformConfig,
  PlatformAdapter,
  PlatformId,
  PostRef,
  Verdict,
} from "@/src/core/types";
import type { MountedUi } from "@/src/ui/mount";

export interface OnSightRuntime {
  config: EffectivePlatformConfig;
  weights: PlatformWeights;
  settings: Settings;
}

export type ScorerFactory = (runtime: () => OnSightRuntime) => Scorer;

/** What a platform hands the shared wiring. */
export interface OnSightPlatform {
  platform: PlatformId;
  adapter: PlatformAdapter;
  /** How the hover card names the account, such as "u/name" on Reddit. */
  cardHandle: (handle: string) => string;
  /**
   * When an author's Tier 2 lookup runs: as their post comes near the viewport (the default), or
   * only when their badge is hovered, for a lookup too costly to make for every author on a page.
   */
  lookups?: "onSight" | "onHover";
}

export interface WireOnSightOptions {
  /** Replaces the platform's adapter, so tests can hand it fake sources. */
  adapter?: PlatformAdapter;
  loadRuntime?: () => Promise<OnSightRuntime>;
  scorer?: ScorerFactory;
  openSettings?: () => void;
}

/** One discovered post: its resolver handle, latest verdict and badge mount. */
export interface BadgeSlot {
  post: PostRef;
  handle: BadgeHandle;
  verdict: Verdict;
  mounted: MountedUi | null;
  container: HTMLElement | null;
  mounting: Promise<void> | null;
  unsubscribe: () => void;
}
