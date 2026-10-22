# ADR-0007: Signed remote policy file that can only restrict

Status: Accepted
Date: 2026-10-22

## Context

ADR-0006 needs a way to flip tier switches, lower weights, or disable a platform without a store
resubmission. Chrome Web Store policy forbids remotely loaded code but permits remotely loaded data and
configuration as long as the logic ships in the package. A remote file is also an attack surface: if
someone replaced it they could, in principle, turn the extension into something more aggressive than
what the store reviewed.

## Decision

The extension fetches a small JSON policy file from GitHub Pages served out of this repository
(`policy/dist/v1.json`) about once a day via `chrome.alarms` with jitter. The file is a signed envelope
(ADR-0009). After signature verification and schema validation, `applyPolicy(buildDefaults, policy)`
produces the effective config under a strict rule: **the policy can only restrict relative to build
defaults, never enable.**

- `enabled = build.enabled && policy.enabled`, for platforms and tiers alike.
- `cap = min(build.cap, policy.cap)`; bins are clamped to the effective cap.
- `prior` is clamped to `[-5, 0]` so it can only move toward "typical".
- Thresholds are clamped to `[0.15, 0.95]` with `many >= some + 0.1`.
- Platforms or features the build does not know are ignored.
- `version` is monotonic; a lower version than the cached one is rejected (anti-rollback).

Last-known-good semantics: any failure (network, bad signature, invalid schema, rollback) leaves the
cached policy untouched and records the attempt. With no cached policy, baked defaults apply. The
policy may carry an optional `notice` shown once in the popup to explain a change.

Users additionally get a "conservative mode" toggle (drops Tier 2 everywhere) and per-platform
on/off switches, applied after the policy.

## Consequences

- The maintainer can throttle or pause a platform within a day by editing one file, signing it, and
  pushing. `docs/policy-ops.md` is the runbook.
- A compromised policy file can at worst switch Botdar off; it cannot make it do more.
- The restrict-only merge needs an exhaustive unit test matrix for every "cannot enable" case.
- The extension is never fully offline-dependent on the file; defaults are baked.

## Alternatives considered

- **Cloudflare Worker.** Rejected for v1: needs an account and a privacy note; GitHub Pages is free,
  versioned and reviewed through commits.
- **Policy that can enable features.** Rejected: it would make the remote file a remote-code
  equivalent in effect and an attractive target.
