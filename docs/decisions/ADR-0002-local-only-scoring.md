# ADR-0002: Local-only scoring in v1, with a seam for an optional cloud layer

Status: Accepted
Date: 2026-10-22

## Context

Botdar is a public free product. Every byte that leaves the browser creates obligations: Chrome Web
Store Limited Use treats viewed handles sent to a server as "browsing activity" requiring prominent
disclosure, Firefox requires manifest-level data-collection declarations, and the legal research showed
that litigation risk rises sharply when an extension pools or transmits data (Meta v. BrandTotal was
about an extension that sent session data to a server). A backend also costs money and needs a
privacy policy, abuse controls and uptime.

At the same time, the heuristics research is clear that the strongest tell for LLM-driven reply bots
is coordination across accounts (fox8 study), which a single browser cannot see. A future cloud layer
(LLM content analysis, shared verdict cache, coordination detection) could add real signal.

## Decision

All scoring, caching and feedback storage run inside the browser in v1. Nothing leaves the browser
except the daily fetch of the signed policy file (ADR-0007) and the platform requests the user's own
session would make anyway or that Tier 2 sources make explicitly (ADR-0006).

Design a seam now so a cloud layer can be added without restructuring: `SignalSource` is the only
abstraction that produces account signals, and a remote source would simply be another
`SignalSource` with `kind: 'active'` and its own tier switch. The scoring engine and UI do not know
where signals came from beyond the tier recorded in `provenance`.

## Consequences

- Zero hosting cost, no privacy policy burden beyond "nothing leaves your browser", and the simplest
  possible store review.
- No cross-user learning; calibration relies on the maintainer's own sessions and locally exported
  feedback.
- Coordination-based detection is out of scope until the cloud layer exists.
- Any future cloud source must be opt-in, disclosed in the store listing, and switchable by policy.

## Alternatives considered

- **Bring-your-own Claude API key.** Rejected for v1: power-user only, and still sends account
  content to a third party from the user's browser.
- **Hosted backend from day one.** Rejected: cost, privacy policy, abuse limits and a far larger
  legal surface before the product has proven useful.
