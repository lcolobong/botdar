# ADR-0006: Tiered signal sources with per-platform switches

Status: Accepted
Date: 2026-10-22

## Context

The maintainer raised a specific concern: if Botdar became popular, X could generate bad publicity and
pressure a shutdown, so there must be a way to switch off the riskier behaviour and fall back to safer
heuristics without a store resubmission. The research showed the risk is not uniform: reading what the
page already rendered is near-zero risk, reading JSON the page already fetched for itself adds no
traffic but touches internal APIs, and issuing extra requests (X `AboutAccountQuery`, Reddit
`about.json`) is visible to the platform and subject to rate limits and account locks.

## Decision

Every signal source carries a tier, and every tier is switchable per platform:

| Tier | Meaning | Examples |
|---|---|---|
| 0 | Rendered DOM only; nothing the page did not display | handle, avatar, badge, join date on a profile, karma on a Reddit profile |
| 1 | Passive interception of JSON responses the page fetched for itself; no extra requests | X timeline GraphQL author objects, Bluesky feed author objects |
| 2 | Active on-demand lookups, cached and rate-limited | X `AboutAccountQuery` on hover, Reddit `about.json`, Bluesky public `getProfiles` |

`SignalSource.tier` is a required field. The pipeline merges signals so a higher tier overwrites a
lower one for the same field and records which tier set each field in `provenance`. The scoring engine
computes confidence from which tiers delivered data, so switching a tier off degrades the verdict to
lower confidence instead of breaking it. Switches are read from the effective config, which is build
defaults narrowed by the remote policy (ADR-0007) and then by user settings.

## Consequences

- A platform can be throttled from "full" to "DOM only" in one policy change, with the UI honestly
  showing lower confidence rather than silently wrong verdicts.
- Every source needs tests for the "tier off" path, and the hover card needs a confidence note.
- X in Tier 0 only is weak (feed shows no join date or counts); that is accepted and documented.

## Alternatives considered

- **One global on/off switch.** Rejected: too blunt; the maintainer wants degraded operation, not
  shutdown.
- **No switches, resubmit to the store when needed.** Rejected: store review takes days and the
  concern is precisely about reacting fast.
