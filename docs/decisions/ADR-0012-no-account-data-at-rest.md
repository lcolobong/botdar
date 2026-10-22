# ADR-0012: No per-account data at rest

Status: Accepted
Date: 2026-10-22

## Context

Botdar sees the handle of every account the user scrolls past, plus profile metadata. Persisting that
would create a browsing-history-shaped dataset on disk: a privacy liability, a Chrome Limited Use
disclosure question, and something a subpoena or a malware author could target. Caching is still
needed so hover lookups are not repeated and so verdicts are stable while scrolling.

## Decision

- Signals, verdicts and Tier 2 lookup results live only in memory, per tab, in a TTL LRU with a 24-hour
  ceiling. Closing the tab discards them. Mirroring to `storage.session` is an optional later
  improvement and would still be cleared when the browser closes.
- `storage.local` holds only: user settings, the last-known-good policy and fetch metadata, the
  onboarding-seen flag, seen notice IDs, and feedback.
- Feedback ("This looks wrong") is the single persisted account reference. It is user-initiated,
  stores the handle, platform, verdict tier, the feature vector and a timestamp, is exportable as
  JSON from the options page, can be cleared there, and is never transmitted.
- Dev builds may log feature vectors locally for the calibration pass; that code path is compiled out
  of release builds.

## Consequences

- The store disclosure can state plainly that nothing is collected or transmitted.
- Verdicts recompute on every fresh tab; with Tier 1 that is free, with Tier 2 it is one cached call
  per hovered account per day.
- No cross-session "I've seen this account before" memory; that would belong to the cloud layer
  (ADR-0002) if it ever exists.

## Alternatives considered

- **Persist verdicts in `storage.local`.** Rejected: creates the browsing-history dataset this ADR
  exists to avoid, for a minor speed gain.
- **IndexedDB cache with encryption.** Rejected: complexity for no user-visible benefit.
