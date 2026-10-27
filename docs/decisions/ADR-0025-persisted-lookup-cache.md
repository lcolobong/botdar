# ADR-0025: Persist Tier 2 lookups on the device

Status: Accepted · Date: 2026-10-26 · Implements ADR-0018 (Shape A) · Amends ADR-0012

## Context

ADR-0018 decided to persist the local Tier 2 cache in v1.1 and left the details open. ADR-0012 kept
all account data in memory, so every reload re-fetched the same profiles and the first paint of a
revisited feed lacked Tier 2 evidence. Persisting is the cheapest way to fix that: no server, no
transmission, one more local store.

## Decision

- **A persisted layer under the memory cache.** Reads go memory, then `storage.local`; a storage hit
  refills memory. Writes happen on every successful Tier 2 delivery.
- **One key per account**, named `lookups.v1.` plus the SHA-256 of `salt | platform | lowercased
  handle`. The salt is 128 random bits created once per install in `lookups.salt.v1`. A dump of storage
  lists no handles and cannot be matched against a known handle without the salt.
- **Stored value**: the Tier 2 signal snapshot (the fields the memory cache holds, except
  `displayName`), the fetch time and the source tier. No raw handle and no bio text: every scorer only
  asks whether the bio is empty, so a boolean is stored and a read rebuilds `bio` as an empty string or
  a one-character stand-in, which keeps names, handles and URLs from bios out of storage. Reads
  validate every field (enumerated values against their known set, strings capped at 64 characters)
  and drop anything else; an entry whose fetch time is in the future counts as expired.
- **Seven-day TTL from the fetch**, enforced lazily on read (the entry is deleted) and by a sweep on
  install, browser start and a daily alarm (a second alarm beside the policy one). A storage hit
  refills memory for the shorter of 24 hours and the entry's remaining life, so memory never serves a
  snapshot past its seven days.
- **Size cap of 5,000 entries**, dropping the oldest by fetch time, enforced by the sweep. A small
  index key (`lookups.index.v1`, entry key to fetch time) lets the sweep work without loading all of
  `storage.local`; writes are merged into it by a sweep five seconds after the last write, so the cap
  can be exceeded briefly. The index is advisory: it is rebuilt from one full scan when missing or
  older than seven days, which also bounds how long an entry a closed tab or a race left unindexed can
  outlive its expiry. The salt is read once per context and reloaded when another context rotates it.
- **Concurrency with the setting.** The options page waits for the setting to be saved before it wipes,
  and the sweep wipes everything while `persistLookups` is off, so a write that was already past its
  check cannot leave data behind for long. A hover that arrives while an on-sight lookup is still
  reading storage is promoted once the lookup is queued, and a lookup whose Tier 2 was switched off
  during the read settles without fetching.
- **`persistLookups` setting, on by default** (ADR-0018 asks for the feature; it is switchable because it
  is the first account-derived data at rest). Off wipes the store and stops reads and writes.
- **"Clear cached lookups"** on the options page (two-step confirm, like the feedback clear; an error
  caption if it fails) removes every entry and rotates the salt, so nothing written earlier can be
  matched again. It scans all of storage rather than trusting the index, because a wipe must not leave
  unindexed entries behind.
- **Conservative mode and Tier 2 off (policy or settings) mean no reads and no writes.**
- **The feedback store is unchanged and separate.** It remains the only store that holds a readable
  handle.

## Consequences

- Revisited accounts show Tier 2 evidence at once and cost no request for a week.
- A stale value can be shown for up to seven days; the account's own age and counts drift slowly
  relative to that, and a hover never forces a refresh while an entry is live (a later change could add
  one).
- Keys are not anonymous against someone holding both the salt and a list of candidate handles; the
  protection is against casual inspection of a storage dump, not a targeted forensic search. The
  privacy page says "no readable handles", not "no account data".
- Two tabs creating the salt at the same moment can leave one tab's first entry unmatchable; it expires
  harmlessly.
- Up to about 2 MB of `storage.local` at the cap, within the default quota.

## Alternatives considered

- **Session-only (`storage.session`).** Rejected: cleared when the browser closes, so the benefit
  mostly disappears; it was the optional improvement in ADR-0012 and remains available as a fallback.
- **Unsalted hash keys.** Rejected: a handle is low-entropy and public, so an unsalted hash can be
  reversed by hashing a list of candidates.
- **Longer TTL.** Rejected: follower counts and account age move, and the ADR-0018 staleness policy
  caps Tier 2 fields at a week; a longer window raises the chance of a wrong label for no clear gain.
