/**
 * The shape of one persisted lookup on disk and of the sweep index (ADR-0025): which signal fields
 * are stored and how each is validated, the stored-signal conversions, and the untrusted-data parsers
 * for entries and the index. Nothing here touches `storage.local`; the store in ../persistedLookups.ts
 * does.
 */
import type { DeclaredBy, PartialSignals, SourceTier, VerifiedKind } from "../types.ts";

export const LOOKUP_KEY_PREFIX = "lookups.v1.";
export const LOOKUP_SALT_KEY = "lookups.salt.v1";
export const LOOKUP_INDEX_KEY = "lookups.index.v1";
/** Scorers only test `bio.trim().length === 0`; a read of a non-empty bio gets this stand-in text. */
export const NON_EMPTY_BIO_PLACEHOLDER = "…";

const MAX_STRING_LENGTH = 64;

const VERIFIED_KINDS: readonly VerifiedKind[] = ["none", "blue", "org", "gov"];
const DECLARED_BY: readonly DeclaredBy[] = ["label", "flair", "name", "bio"];

type StoredSignals = Record<string, unknown>;

export interface StoredLookup {
  signals: StoredSignals;
  fetchedAt: number;
  tier: SourceTier;
  /** Only a facet's entry carries its own lifetime; the rest live `LOOKUP_TTL_MS`. */
  ttlMs?: number;
}

/** Entry key to fetch time, and to lifetime for the entries (facets) that differ from the default. */
export interface LookupIndex {
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

export function toStoredSignals(signals: PartialSignals): StoredSignals {
  const { bio, ...rest }: PartialSignals = signals;
  const candidate: Record<string, unknown> = { ...rest };
  if (typeof bio === "string") candidate.bioEmpty = bio.trim().length === 0;
  return sanitizeStored(candidate);
}

export function fromStoredSignals(stored: StoredSignals): PartialSignals {
  const { bioEmpty, ...rest }: StoredSignals = stored;
  const signals: Record<string, unknown> = { ...rest };
  if (typeof bioEmpty === "boolean") {
    signals.bio = bioEmpty ? "" : NON_EMPTY_BIO_PLACEHOLDER;
  }
  return signals as PartialSignals;
}

export function parseStoredLookup(raw: unknown): StoredLookup | null {
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

export function parseIndex(raw: unknown): LookupIndex | null {
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
