# Decision log

This directory holds Architecture Decision Records (ADRs) for Botdar. An ADR captures one decision that
would be expensive to reverse or that a future contributor would otherwise have to reconstruct from
commit history: what was decided, why, what it costs, and what was rejected. ADRs are immutable once
accepted; a change of mind gets a new ADR that supersedes the old one, and the old one's Status is
updated to "Superseded by ADR-00NN".

## Template

```
# ADR-00NN: <title>

Status: Proposed | Accepted | Superseded by ADR-00NN
Date: YYYY-MM-DD

## Context
What situation forced a decision. Facts, constraints, research findings with sources.

## Decision
The decision, stated in one or two sentences, then the specifics.

## Consequences
What becomes easier, what becomes harder, what we now owe (tests, docs, operations).

## Alternatives considered
Each rejected option with the reason it lost.
```

## Numbering

Four digits, zero-padded, assigned in the order decisions are accepted. Numbers are never reused.
File name is `ADR-00NN-<kebab-case-slug>.md`.

## Index

| ADR | Title | Summary |
|---|---|---|
| [0001](ADR-0001-chrome-extension-first.md) | Chrome extension first | Ship as a Chrome/Firefox MV3 extension; iOS later as a Safari Web Extension, since nothing can annotate inside native apps. |
| [0002](ADR-0002-local-only-scoring.md) | Local-only scoring | All scoring in the browser in v1; a defined seam for an optional cloud layer later. |
| [0003](ADR-0003-three-tier-verdict.md) | Three-tier verdict, neutral wording | Tiers not percentages; never "bot" or "fake" about a named account; top tier needs two independent signals. |
| [0004](ADR-0004-heuristics-not-trained-model.md) | Hand-tuned heuristics | Weighted log-odds rules rather than a model trained on public bot datasets. |
| [0005](ADR-0005-platform-roadmap.md) | Platform roadmap | v1 X + Reddit + Bluesky; v1.1 YouTube + Hacker News; v1.2 Mastodon; Threads after legal review; others deferred; LinkedIn never. |
| [0006](ADR-0006-tiered-signal-sources.md) | Tiered signal sources | Every source has a tier (DOM, passive, active) switchable per platform. |
| [0007](ADR-0007-signed-restrict-only-policy.md) | Signed restrict-only policy | A signed remote policy file on GitHub Pages that can only turn things down, with last-known-good fallback and a user conservative mode. |
| [0008](ADR-0008-launch-tier-defaults.md) | Launch tier defaults | Tier 1 and Tier 2 on by default for every v1 platform. |
| [0009](ADR-0009-es256-policy-signing.md) | ES256 policy signing | ECDSA P-256 with WebCrypto verification and a baked public key; Pages deploy verifies, never signs. |
| [0010](ADR-0010-stack-wxt-preact.md) | Stack | WXT + TypeScript + Preact + Vitest on pnpm; Preact is the only runtime dependency. |
| [0011](ADR-0011-main-world-interception.md) | MAIN-world interception | Patch fetch/XHR in the page world for an allowlist of operations; relay through a guarded postMessage; parse in the isolated world. |
| [0012](ADR-0012-no-account-data-at-rest.md) | No per-account data at rest | In-memory 24h cache only; feedback is the sole persisted account reference and never leaves the browser. |
| [0013](ADR-0013-minimal-permissions.md) | Minimal permissions | Explicit host permissions, no `<all_urls>`, no `web_accessible_resources`, no remote code. |
| [0014](ADR-0014-docs-in-repo-mirrored-to-notion.md) | Docs in repo, mirrored to Notion | `docs/` is canonical and reviewed in PRs; Notion holds mirrors and the task tracker. |
| [0015](ADR-0015-bluesky-extension-not-labeler.md) | Bluesky via extension | Bluesky support ships inside the extension; a labeler is a separate later decision. |
| [0016](ADR-0016-public-repo-stacked-prs.md) | Public repo, stacked PRs | Public GitHub repo, small commits, stacked PRs, rebase-merge, 250/400 production-line limits. |
| [ADR-0017](ADR-0017-badge-wording-and-label-styles.md) | Badge wording, quiet feed, selectable label styles | Plain "Likely bot" / "Unsure" / "Declared bot" labels, no badge on fine accounts, optional Likely human, Sus scale and icon-only styles; amends ADR-0003 |
| [ADR-0018](ADR-0018-no-shared-cache-yet.md) | No shared verdict cache yet | Shapes, costs, legal posture, staleness and disputes explored; persisted local cache in v1.1, no server until three conditions hold; extends ADR-0002 and ADR-0012 |
| [ADR-0019](ADR-0019-analyse-posts-near-the-viewport.md) | Analyse posts near the viewport | Posts are discovered eagerly but extracted, scored and badged only within a screen of the viewport, in 8 ms idle slices. |
| [ADR-0021](ADR-0021-record-live-markup-before-building.md) | Record live markup before building | A platform adapter starts from a `pnpm capture` recording of the live page from the maintainer's own Chrome; fixture headers state their provenance; unconfirmed selectors are marked GUESS; raw captures never enter git; amends ADR-0016 |
