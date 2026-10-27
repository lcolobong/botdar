/**
 * The on-device layer under the in-memory Tier 2 cache (ADR-0025, amending ADR-0012). Each entry is
 * one `storage.local` key whose name is a salted hash of platform and handle, so a dump of storage
 * lists no handles and cannot be matched against a known handle without the salt. The value is the
 * Tier 2 signal snapshot, the fetch time and the source tier: no display name, no raw handle, and no
 * bio text (only whether the bio is empty, which is all the scorers ask). Entries expire seven days
 * after the fetch (a facet, below, on its own shorter clock); the feedback store is separate and untouched.
 *
 * A small index key (`lookups.index.v1`: entry key to fetch time) lets the sweep expire and cap
 * entries without loading all of storage. It is advisory: writes reach it only when the debounced
 * sweep merges them, so a closed tab or a race can leave an entry unindexed. The sweep therefore
 * rebuilds the index from one full scan whenever it is missing or older than the TTL, which bounds
 * how long an unindexed entry can outlive its expiry.
 */
import { browser } from "wxt/browser";
import type { DeclaredBy, PartialSignals, PlatformId, SourceTier, VerifiedKind } from "./types.ts";

export const LOOKUP_KEY_PREFIX = "lookups.v1.";
export const LOOKUP_SALT_KEY = "lookups.salt.v1";
export const LOOKUP_INDEX_KEY = "lookups.index.v1";
export const LOOKUP_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;
export const LOOKUP_MAX_ENTRIES = 5000;
/** Writes in a burst share one index merge; this is also the longest the cap can be exceeded. */
export const SWEEP_DEBOUNCE_MS = 5000;
/** Scorers only test `bio.trim().length === 0`; a read of a non-empty bio gets this stand-in text. */
export const NON_EMPTY_BIO_PLACEHOLDER = "…";

/**
 * Handles are folded to lowercase before hashing, except where case tells accounts apart: Hacker
 * News usernames are case-sensitive (Firebase answers `null` for the wrong case), so "Foo" and "foo"
 * are two accounts there.
 */
const CASE_SENSITIVE_HANDLES: ReadonlySet<PlatformId> = new Set<PlatformId>(["hackernews"]);
const SALT_BYTES = 16;
const MAX_STRING_LENGTH = 64;

const VERIFIED_KINDS: readonly VerifiedKind[] = ["none", "blue", "org", "gov"];
const DECLARED_BY: readonly DeclaredBy[] = ["label", "flair", "name", "bio"];

type StoredSignals = Record<string, unknown>;

interface StoredLookup {
  signals: StoredSignals;
  fetchedAt: number;
  tier: SourceTier;
  /** Only a facet's entry carries its own lifetime; the rest live `LOOKUP_TTL_MS`. */
  ttlMs?: number;
}

/** Entry key to fetch time, and to lifetime for the entries (facets) that differ from the default. */
interface LookupIndex {
  rebuiltAt: number;
  entries: Record<string, number>;
  ttls: Record<string, number>;
}

/**
 * A second, independently expiring snapshot kept for the same account: a source that runs apart
 * from the account's main lookup (hover-only, `SignalSource.hoverOnly`) stores under its own key
 * and lifetime, so neither overwrites or outlives the other. The lifetime is kept in the entry and
 * the index, so the sweep drops a dead facet on time and it never takes capacity from a live
 * profile snapshot.
 */
export interface LookupFacet {
  id: string;
  ttlMs: number;
}

/** What a read returns: the snapshot and how long it may still be trusted. */
export interface PersistedLookup {
  signals: PartialSignals;
  remainingMs: number;
}

type FieldCheck = (value: unknown) => boolean;
const isNumber: FieldCheck = (value) => typeof value === "number" && Number.isFinite(value);
const isBoolean: FieldCheck = (value) => typeof value === "boolean";
const isShortString: FieldCheck = (value) =>
  typeof value === "string" && value.length <= MAX_STRING_LENGTH;
const oneOf =
  (choices: readonly string[]): FieldCheck =>
  (value) =>
    typeof value === "string" && choices.includes(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every stored field and how its value is validated; `displayName` and `bio` are never stored. */
const PERSISTED_FIELD_CHECKS: Record<string, FieldCheck> = {
  createdAt: isNumber,
  followers: isNumber,
  following: isNumber,
  postCount: isNumber,
  linkKarma: isNumber,
  commentKarma: isNumber,
  karma: isNumber,
  bioEmpty: isBoolean,
  hasDefaultAvatar: isBoolean,
  verified: oneOf(VERIFIED_KINDS),
  declaredAutomated: isBoolean,
  declaredBy: oneOf(DECLARED_BY),
  hasVerifiedEmail: isBoolean,
  country: isShortString,
  usernameChanges: isNumber,
  appStore: isShortString,
  oldestItemAt: isNumber,
  visibleItemCount: isNumber,
  replyShare: (value) => isRecord(value) && isNumber(value.ratio) && isNumber(value.sampleSize),
};

/** Stored data is untrusted: unknown or mistyped fields are dropped rather than trusted. */
function sanitizeStored(raw: unknown): StoredSignals {
  const clean: StoredSignals = {};
  if (!isRecord(raw)) return clean;
  for (const [field, check] of Object.entries(PERSISTED_FIELD_CHECKS)) {
    if (check(raw[field])) clean[field] = raw[field];
  }
  return clean;
}

function toStoredSignals(signals: PartialSignals): StoredSignals {
  const { bio, ...rest }: PartialSignals = signals;
  const candidate: Record<string, unknown> = { ...rest };
  if (typeof bio === "string") candidate.bioEmpty = bio.trim().length === 0;
  return sanitizeStored(candidate);
}

function fromStoredSignals(stored: StoredSignals): PartialSignals {
  const { bioEmpty, ...rest }: StoredSignals = stored;
  const signals: Record<string, unknown> = { ...rest };
  if (typeof bioEmpty === "boolean") {
    signals.bio = bioEmpty ? "" : NON_EMPTY_BIO_PLACEHOLDER;
  }
  return signals as PartialSignals;
}

function parseStoredLookup(raw: unknown): StoredLookup | null {
  if (!isRecord(raw) || typeof raw.fetchedAt !== "number" || raw.tier !== 2) return null;
  if (!Number.isFinite(raw.fetchedAt)) return null;
  const lookup: StoredLookup = {
    signals: sanitizeStored(raw.signals),
    fetchedAt: raw.fetchedAt,
    tier: 2,
  };
  if (isNumber(raw.ttlMs) && (raw.ttlMs as number) > 0) lookup.ttlMs = raw.ttlMs as number;
  return lookup;
}

function parseIndex(raw: unknown): LookupIndex | null {
  if (!isRecord(raw) || !isNumber(raw.rebuiltAt) || !isRecord(raw.entries)) return null;
  const entries: Record<string, number> = {};
  for (const [key, fetchedAt] of Object.entries(raw.entries)) {
    if (key.startsWith(LOOKUP_KEY_PREFIX) && typeof fetchedAt === "number") {
      entries[key] = fetchedAt;
    }
  }
  const ttls: Record<string, number> = {};
  if (isRecord(raw.ttls)) {
    for (const [key, ttlMs] of Object.entries(raw.ttls)) {
      if (key in entries && isNumber(ttlMs)) ttls[key] = ttlMs as number;
    }
  }
  return { rebuiltAt: raw.rebuiltAt as number, entries, ttls };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class PersistedLookupStore {
  private cachedSalt: Promise<string> | null = null;
  /** The salt this instance wrote or read, so its own storage events do not look like a rotation. */
  private knownSalt: string | null = null;
  private unindexed: Record<string, number> = {};
  private unindexedTtls: Record<string, number> = {};
  private sweepTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly now: () => number = Date.now) {
    // Another context (the options page) rotates the salt on clear.
    browser.storage.onChanged.addListener((changes, areaName) => {
      const change: { newValue?: unknown } | undefined = changes[LOOKUP_SALT_KEY];
      if (areaName === "local" && change !== undefined && change.newValue !== this.knownSalt) {
        this.cachedSalt = null;
      }
    });
  }

  /** The snapshot for this account, or undefined when absent or expired (and then deleted). */
  async read(
    platform: PlatformId,
    handle: string,
    facet?: LookupFacet,
  ): Promise<PersistedLookup | undefined> {
    const key: string = await this.keyFor(platform, handle, facet);
    const ttlMs: number = facet?.ttlMs ?? LOOKUP_TTL_MS;
    const stored: Record<string, unknown> = await browser.storage.local.get(key);
    const lookup: StoredLookup | null = parseStoredLookup(stored[key]);
    if (lookup === null || this.isExpired(lookup.fetchedAt, ttlMs)) {
      if (key in stored) await browser.storage.local.remove(key);
      return undefined;
    }
    return {
      signals: fromStoredSignals(lookup.signals),
      remainingMs: ttlMs - (this.now() - lookup.fetchedAt),
    };
  }

  async write(
    platform: PlatformId,
    handle: string,
    signals: PartialSignals,
    facet?: LookupFacet,
  ): Promise<void> {
    const key: string = await this.keyFor(platform, handle, facet);
    const fetchedAt: number = this.now();
    const lookup: StoredLookup = { signals: toStoredSignals(signals), fetchedAt, tier: 2 };
    if (facet !== undefined) lookup.ttlMs = facet.ttlMs;
    await browser.storage.local.set({ [key]: lookup });
    this.unindexed[key] = fetchedAt;
    if (facet !== undefined) this.unindexedTtls[key] = facet.ttlMs;
    this.scheduleSweep();
  }

  /** Merges recent writes into the index, then drops expired entries and the oldest beyond the cap. */
  async sweep(): Promise<void> {
    clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
    const merged: Record<string, number> = { ...this.unindexed };
    const mergedTtls: Record<string, number> = { ...this.unindexedTtls };
    this.unindexed = {};
    this.unindexedTtls = {};
    const stored: Record<string, unknown> = await browser.storage.local.get(LOOKUP_INDEX_KEY);
    let index: LookupIndex | null = parseIndex(stored[LOOKUP_INDEX_KEY]);
    if (index === null || this.now() - index.rebuiltAt >= LOOKUP_TTL_MS) {
      index = { rebuiltAt: this.now(), ...(await this.scanEntries()) };
    }
    const entries: Record<string, number> = { ...index.entries, ...merged };
    const ttls: Record<string, number> = { ...index.ttls, ...mergedTtls };
    const doomed: string[] = [];
    const live: Array<[string, number]> = [];
    for (const [key, fetchedAt] of Object.entries(entries)) {
      // A facet's entry is dead at its own lifetime, so it never takes capacity from a live snapshot.
      if (this.isExpired(fetchedAt, ttls[key])) doomed.push(key);
      else live.push([key, fetchedAt]);
    }
    live.sort((first, second) => second[1] - first[1]);
    for (const [key] of live.slice(LOOKUP_MAX_ENTRIES)) doomed.push(key);
    const survivors: Record<string, number> = Object.fromEntries(live.slice(0, LOOKUP_MAX_ENTRIES));
    const survivingTtls: Record<string, number> = Object.fromEntries(
      Object.entries(ttls).filter(([key]) => key in survivors),
    );
    if (doomed.length > 0) await browser.storage.local.remove(doomed);
    await browser.storage.local.set({
      [LOOKUP_INDEX_KEY]: {
        rebuiltAt: index.rebuiltAt,
        entries: survivors,
        ...(Object.keys(survivingTtls).length === 0 ? {} : { ttls: survivingTtls }),
      },
    });
  }

  /**
   * Removes every entry and rotates the salt, so nothing written before can be matched again. This
   * scans all of storage rather than trusting the index, because a wipe must not leave unindexed
   * entries behind.
   */
  async clear(): Promise<void> {
    clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
    this.unindexed = {};
    this.unindexedTtls = {};
    const lookupKeys: string[] = Object.keys((await this.scanEntries()).entries);
    await browser.storage.local.remove([...lookupKeys, LOOKUP_INDEX_KEY]);
    const salt: string = this.newSalt();
    this.knownSalt = salt;
    await browser.storage.local.set({ [LOOKUP_SALT_KEY]: salt });
    this.cachedSalt = Promise.resolve(salt);
  }

  private scheduleSweep(): void {
    if (this.sweepTimer !== undefined) return;
    this.sweepTimer = setTimeout(() => void this.sweep().catch(() => undefined), SWEEP_DEBOUNCE_MS);
  }

  /** A full scan of storage.local: every lookup entry key with its fetch time (0 when unreadable). */
  private async scanEntries(): Promise<Pick<LookupIndex, "entries" | "ttls">> {
    const everything: Record<string, unknown> = await browser.storage.local.get(null);
    const entries: Record<string, number> = {};
    const ttls: Record<string, number> = {};
    for (const [key, raw] of Object.entries(everything)) {
      if (!key.startsWith(LOOKUP_KEY_PREFIX)) continue;
      const lookup: StoredLookup | null = parseStoredLookup(raw);
      entries[key] = lookup?.fetchedAt ?? 0;
      if (lookup?.ttlMs !== undefined) ttls[key] = lookup.ttlMs;
    }
    return { entries, ttls };
  }

  /** A fetch time in the future is treated as expired, so a tampered entry cannot live forever. */
  private isExpired(fetchedAt: number, ttlMs: number = LOOKUP_TTL_MS): boolean {
    const age: number = this.now() - fetchedAt;
    return age < 0 || age >= ttlMs;
  }

  private newSalt(): string {
    return toHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
  }

  /** Created once per install on first use; loaded once per instance until the salt is rotated. */
  private salt(): Promise<string> {
    this.cachedSalt ??= this.loadOrCreateSalt();
    return this.cachedSalt;
  }

  private async loadOrCreateSalt(): Promise<string> {
    const stored: Record<string, unknown> = await browser.storage.local.get(LOOKUP_SALT_KEY);
    const existing: unknown = stored[LOOKUP_SALT_KEY];
    if (typeof existing === "string" && existing.length > 0) {
      this.knownSalt = existing;
      return existing;
    }
    const created: string = this.newSalt();
    this.knownSalt = created;
    await browser.storage.local.set({ [LOOKUP_SALT_KEY]: created });
    return created;
  }

  private async keyFor(platform: PlatformId, handle: string, facet?: LookupFacet): Promise<string> {
    const canonical: string = CASE_SENSITIVE_HANDLES.has(platform) ? handle : handle.toLowerCase();
    const facetSuffix: string = facet === undefined ? "" : `|${facet.id}`;
    const material = `${await this.salt()}|${platform}|${canonical}${facetSuffix}`;
    const digest: ArrayBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(material),
    );
    return LOOKUP_KEY_PREFIX + toHex(new Uint8Array(digest));
  }
}
