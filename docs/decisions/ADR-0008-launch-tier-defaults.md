# ADR-0008: Tier 1 and Tier 2 on by default at launch

Status: Accepted
Date: 2026-10-22

## Context

With tiers switchable (ADR-0006) and a restrict-only policy (ADR-0007), the launch default decides what
first-run users experience. Tier 1 alone gives X join date and counts from timeline responses but no
"About this account" fields (country, username changes, app store), and gives Reddit nothing beyond the
DOM. Tier 2 adds those at the cost of visible extra requests from the user's session: X rate-limits
`AboutAccountQuery` after bursts, and Reddit `about.json` limits for cookie-authenticated requests are
undocumented.

The maintainer weighed the richer out-of-the-box verdicts against the exposure and chose richness,
relying on the kill switch to pull Tier 2 back if needed.

## Decision

Build defaults enable Tier 1 and Tier 2 for X, Reddit and Bluesky. Tier 2 lookups fire on hover (or
on first view only when the user opts into "eager lookups"), are cached in memory for 24 hours, and
run behind a token-bucket limiter with exponential backoff and a circuit breaker (X: 20 per minute,
burst 3; Bluesky: 30 per minute, batched up to 25 actors per call).

## Consequences

- First-run users see the best verdicts Botdar can produce.
- Tier 2 traffic is attributable to the user's account on X and Reddit; the limiter, hover-only
  trigger and cache are the mitigation, and the risk register tracks lock reports as a trigger to
  flip the policy.
- If day-one validation finds X Tier 2 blocked by `x-client-transaction-id`, X Tier 2 ships as passive
  capture only and the default is documented as such in a superseding ADR.

## Alternatives considered

- **Tier 1 on, Tier 2 off by default.** The safer option; rejected by the maintainer in favour of
  richer verdicts, with the policy switch as the backstop.
- **Tier 0 only by default.** Rejected: X verdicts would mostly read "unknown" and the product would
  not demonstrate its value.
