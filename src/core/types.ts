/**
 * Domain contracts shared by every platform adapter, the scoring engine, the policy system and the UI.
 * See docs/architecture.md ("Core type contracts") and docs/scoring-spec.md.
 */

export type PlatformId = "x" | "reddit" | "bluesky" | "hackernews";

/** 0 = rendered DOM only, 1 = passive interception of the page's own responses, 2 = active lookups. */
export type SourceTier = 0 | 1 | 2;

/** Evidence groups; the top tier needs two contributions from distinct groups (ADR-0003). */
export type IndependenceGroup =
  | "age"
  | "activity"
  | "graph"
  | "handle"
  | "profile"
  | "verification"
  | "content"
  | "geo"
  | "timing";

export interface AccountRef {
  platform: PlatformId;
  /**
   * Without a leading "@" or "u/", and lowercased where the platform ignores case. Hacker News
   * usernames are case-sensitive, so its handles keep the casing the page renders.
   */
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
  /** A single karma total, where the platform does not split it (Hacker News). */
  karma?: number;
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
  /**
   * Text of the account's own posts, gathered across responses up to `MAX_POST_TEXT_LENGTH`; read
   * only for the language the account writes in, and kept in memory like every other field.
   */
  postText?: string;
  /**
   * Epoch milliseconds of the account's own posts, newest first, at most 100. Unlike every other
   * field these add up: each response and each tier contributes the posts it carried (pipeline.ts).
   */
  postTimestamps?: number[];
  /** Which tier last supplied each field; drives the source dots, not which tiers delivered. */
  provenance: Partial<Record<SignalField, SourceTier>>;
  /**
   * Tiers that delivered data for this account, ascending. Tracked apart from `provenance` because a
   * higher tier overwriting every field a lower one supplied erases that tier from the provenance
   * while it still delivered.
   */
  tiersDelivered: SourceTier[];
  /** Epoch milliseconds of the newest observation merged in. */
  observedAt: number;
}

/** About a dozen posts: plenty for the language detector, which reads 4,000 characters at most. */
export const MAX_POST_TEXT_LENGTH = 2_000;

export type SignalField = Exclude<
  keyof AccountSignals,
  "ref" | "provenance" | "tiersDelivered" | "observedAt"
>;

/** Keys of the per-platform weights config, e.g. "x.postsPerDay". */
export type FeatureId = string;

export interface Feature {
  id: FeatureId;
  value: number | boolean;
  group: IndependenceGroup;
  tier: SourceTier;
  /**
   * A value the reason line words, computed once with the feature so the template only formats it
   * (the language code the country mismatch compared).
   */
  detail?: string;
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

/** Which way a reason points: towards an automated account or towards an ordinary one. */
export type ReasonDirection = "automated" | "ordinary";

/** One line of the hover card's "Why it leans this way" block. */
export interface VerdictReason {
  /** The observation, e.g. "Joined 3 weeks ago". */
  text: string;
  /** Why the observation points the way it does; empty when the feature has no clause. */
  why: string;
  direction: ReasonDirection;
  /**
   * Signed log-odds contribution after caps, so a strength scale can sit on top of the direction.
   * Absent on the declared reason, which is a disclosure rather than weighed evidence.
   */
  contribution?: number;
  tier: SourceTier;
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
  /** Two to four lines for the hover card. */
  reasons: VerdictReason[];
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

export type PartialSignals = Partial<
  Omit<AccountSignals, "ref" | "provenance" | "tiersDelivered" | "observedAt">
>;

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
  /** Active: true while the source has paused itself after a logged-out answer. */
  loginRequired?: () => boolean;
  /**
   * Active: its fields are never persisted (ADR-0025 stores profile fields only), so a stored
   * snapshot does not answer for it and a lookup that hits storage still runs it.
   */
  memoryOnly?: boolean;
}

export type BadgeDensity = "x" | "reddit-post" | "reddit-comment" | "bluesky" | "hackernews";

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
