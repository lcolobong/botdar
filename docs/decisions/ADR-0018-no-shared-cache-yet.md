# ADR-0018: No shared verdict cache yet, and the conditions for building one

Status: Accepted · Date: 2026-10-22 · Extends ADR-0002 and ADR-0012

## Context

The user asked whether a shared cache of account signals could cut Tier 2 lookups and give verdicts on
first paint, what it would cost to run, whether holding that data raises legal concerns, how stale
records would be handled, and how someone could dispute a label. The exercise is written up in
[shared-cache-exploration.md](../shared-cache-exploration.md): four shapes from a persisted local cache
to a live backend with cross-account signals, a cost table, the GDPR, CCPA and defamation posture, a
per-field staleness policy, and a three-party dispute design (reader, account owner, project).

## Decision

- **No server in v1.x.** Shapes C and D (opt-in contributions, live shared cache) are not built until all
  three conditions hold: a second maintainer, a budget for the recurring abuse, data-subject and
  takedown hours, and a published dispute and removal process. The question is not reopened without a
  change in one of these.
- **Persist the local Tier 2 cache in v1.1** (Shape A): seven-day TTL, keyed by a salted hash of platform
  and account id, size-capped, on the user's device only. This amends ADR-0012's "in-memory only" to
  "on-device only" and adds a line to the privacy page.
- **If a shared layer is ever built, it stores signals, never verdicts**, per the cloud-layer seam; a
  shared record counts as one evidence group and cannot alone reach "Likely bot"; it is keyed by the
  platform's stable account id, not the handle; whole records expire after 30 days without a new
  observation; the policy file can switch the source off and the server can drain.
- **Disputes only ever reduce certainty.** Reader disagreement lowers the shared record's confidence;
  owner proof of control caps the account at "Unsure" for 90 days and opens the erasure path; nothing
  the project hosts asserts "bot" about a named account. The local "I know this account" cap is designed
  into the engine ahead of any server.
- **Bluesky first** for any prototype, as a verifier-backed, signed static-shard publication on the
  existing Pages site, because its data is public by design and contributions can be checked against the
  AppView.

## Consequences

- Tier 2 request volume stays per-user; R-05 mitigations remain the rate limiter and hover-only trigger.
- Coordination signals that need cross-account memory stay out of scope until a shared layer exists;
  the v1.1 countermeasures in [adversarial-evasion.md](../adversarial-evasion.md) are the local ones.
- The project keeps its strongest answer to R-01: nothing exists to shut down except a config file.
- New risk row R-16 tracks the exposure if the conditions are met and a shared layer is started.
