/**
 * Domain contracts shared by every platform adapter, the scoring engine, the policy system and the UI.
 * See docs/architecture.md ("Core type contracts") and docs/scoring-spec.md.
 */

export type PlatformId = "x" | "reddit" | "bluesky";

/** 0 = rendered DOM only, 1 = passive interception of the page's own responses, 2 = active lookups. */
export type SourceTier = 0 | 1 | 2;

/** Evidence groups; the top tier needs two contributions from distinct groups (ADR-0003). */
export type IndependenceGroup =
  "age" | "activity" | "graph" | "handle" | "profile" | "verification" | "content" | "geo";

export interface AccountRef {
  platform: PlatformId;
  /** Lowercased, without a leading "@" or "u/". */
  handle: string;
  /** Platform-native id when known (X rest_id, Bluesky DID, Reddit fullname). */
  id?: string;
}

export type VerifiedKind = "none" | "blue" | "org" | "gov";

export interface ReplyShare {
  ratio: number;
  sampleSize: number;
}

/** Everything observed about one account, with the tier that supplied each field. */
export interface AccountSignals {
  ref: AccountRef;
  /** Epoch milliseconds. */
  createdAt?: number;
  followers?: number;
  following?: number;
  postCount?: number;
  linkKarma?: number;
  commentKarma?: number;
  displayName?: string;
  bio?: string;
  /** true = default or missing avatar; undefined = not observed. */
  hasDefaultAvatar?: boolean;
  verified?: VerifiedKind;
  /**
   * The platform's own automated label (X "Automated", Reddit [App], Bluesky bot self-label), or a
   * self-description the account cannot have made by accident (see `declaredBy`).
   */
  declaredAutomated?: boolean;
  /** What declared the automation; a platform label when absent. */
  declaredBy?: DeclaredBy;
  hasVerifiedEmail?: boolean;
  country?: string;
  usernameChanges?: number;
  appStore?: string;
  /** Only when a timeline was observable. */
  replyShare?: ReplyShare;
  provenance: Partial<Record<SignalField, SourceTier>>;
  /** Epoch milliseconds of the newest observation merged in. */
  observedAt: number;
}

export type SignalField = Exclude<keyof AccountSignals, "ref" | "provenance" | "observedAt">;

/** Keys of the per-platform weights config, e.g. "x.postsPerDay". */
export type FeatureId = string;

export interface Feature {
  id: FeatureId;
  value: number | boolean;
  group: IndependenceGroup;
  tier: SourceTier;
}

export interface Evidence {
  feature: FeatureId;
  /** Log-odds contribution after per-feature and group caps. */
  contribution: number;
  group: IndependenceGroup;
  tier: SourceTier;
  /** Neutral, factual, rendered from docs/scoring-spec.md templates. */
  reason: string;
}

/**
 * Internal tier names are stable; rendered labels map onto them per label style (ADR-0017):
 * many = Likely bot, some = Unsure, declared = Declared bot, typical = Likely human,
 * unknown = no read (nothing beyond the handle, or no features at all).
 */
export type VerdictTier = "typical" | "some" | "many" | "declared" | "unknown";

export interface Verdict {
  tier: VerdictTier;
  probability: number;
  logOdds: number;
  /** Sorted by absolute contribution, descending. */
  evidence: Evidence[];
  /** Two to four strings for the hover card. */
  reasons: string[];
  /** 0..1, share of data sources that delivered. */
  confidence: number;
  confidenceNote?: string;
  /** The "This can be wrong:" line. */
  caveat: string;
  sourcesUsed: SourceTier[];
  sourcesMissing: SourceTier[];
  /** Drives the hollow badge; also caps the tier at "some". */
  lowConfidence: boolean;
  policyVersion: number;
  computedAt: number;
}

export interface TierSwitches {
  t1: boolean;
  t2: boolean;
}

/** Effective per-platform configuration after build defaults, policy and user settings are merged. */
export interface EffectivePlatformConfig {
  platform: PlatformId;
  enabled: boolean;
  tiers: TierSwitches;
  /** Active lookups per minute. */
  rateLimitPerMinute: number;
  policyVersion: number;
  /** X only: the current `AboutAccountQuery` GraphQL query id when the policy supplies one. */
  aboutAccountQueryId?: string;
}

export interface ResolveContext {
  signal: AbortSignal;
  config: EffectivePlatformConfig;
}

export type PartialSignals = Partial<Omit<AccountSignals, "ref" | "provenance" | "observedAt">>;

export type SignalEmitter = (ref: AccountRef, partial: PartialSignals) => void;

/** One source of signals. Passive sources push; active sources are pulled on demand by the pipeline. */
export interface SignalSource {
  id: string;
  platform: PlatformId;
  tier: SourceTier;
  kind: "passive" | "active";
  /** Passive: start listening; returns an unsubscribe function. */
  start?: (emit: SignalEmitter) => () => void;
  /** Active: resolve on demand. Rate limiting and caching are the pipeline's job, not the source's. */
  resolve?: (ref: AccountRef, context: ResolveContext) => Promise<PartialSignals | null>;
}

export type BadgeDensity = "x" | "reddit-post" | "reddit-comment" | "bluesky";

export interface PostRef {
  /** The post container (article, shreddit-post, shreddit-comment, Bluesky post). */
  element: Element;
  ref: AccountRef;
  /** The element the badge mounts after, normally the handle link. */
  anchor: Element;
  isReply?: boolean;
  /** Reddit tells posts from comments; the diagnostics panel counts them apart. */
  kind?: "post" | "comment";
  nativeLabel?: "automated";
  /** Overrides the adapter's badgeDensity for platforms that mix densities in one feed (Reddit posts and comments). */
  density?: BadgeDensity;
}

export interface PlatformAdapter {
  id: PlatformId;
  matches: (url: URL) => boolean;
  /** Observe the feed; returns a stop function. */
  observeFeed: (
    onPost: (post: PostRef) => void,
    onRemoved: (element: Element) => void,
  ) => () => void;
  /** Tier 0: what the rendered page shows for this post's author. */
  extractDomSignals: (post: PostRef) => PartialSignals;
  sources: SignalSource[];
  toFeatures: (signals: AccountSignals) => Feature[];
  badgeDensity: BadgeDensity;
}

/** Where a declared-automation signal came from: the platform, or the account's own words. */
export type DeclaredBy = "label" | "flair" | "name" | "bio";
