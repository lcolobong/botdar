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
| [0005](ADR-0005-platform-roadmap.md) | Platform roadmap | v1 X + Reddit + Bluesky; v1.1 YouTube + Hacker News; v1.2 Mastodon; Threads after legal review; others deferred; LinkedIn never. Hacker News moved into v1 by ADR-0026. |
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
| [ADR-0020](ADR-0020-badge-on-every-account.md) | Badge on every account | Likely human on by default and earned (confidence ≥ 0.5, two worded reasons beyond the handle that do not point towards automation), No read badge for unknown, Checking while a lookup runs, Reddit Tier 2 on sight behind the queue and limiter, X and Bluesky hover-only; amends ADR-0017 |
| [ADR-0021](ADR-0021-record-live-markup-before-building.md) | Record live markup before building | A platform adapter starts from a `pnpm capture` recording of the live page from the maintainer's own Chrome; fixture headers state their provenance; unconfirmed selectors are marked GUESS; raw captures never enter git; amends ADR-0016 |
| [ADR-0022](ADR-0022-reasons-say-why.md) | Reasons say why; the caveat is labelled | Each reason carries an arrow towards automated or ordinary and a short why clause that tracks the scoring-spec rationale; "Why it leans this way" and "Why this could be wrong" label the reasons and the caveat; Likely human cards get a counter-case by group; amends ADR-0017 and ADR-0020 |
| [ADR-0023](ADR-0023-strength-scale-and-progressive-disclosure.md) | A strength scale on every reason; why clauses wait behind one toggle | A bar beside each arrow grades a reason weak, moderate or strong from its contribution (red through amber and grey to green, with the fill's height and the marker's name as the non-colour cues); one "What these mean" toggle under the reasons shows every why clause, none on a Declared bot card; amends ADR-0022 |
| [ADR-0024](ADR-0024-posting-cadence-features.md) | Posting-cadence features ship now, X passive only | Gap regularity and the sleep window on X and Bluesky at the spec'd weights under a timing cap of 1.5; X from Tier 1 profile timelines only, Bluesky one public getAuthorFeed per hover; Reddit deferred until measured; weights restrict-able by policy pending calibration |
| [ADR-0025](ADR-0025-persisted-lookup-cache.md) | Persist Tier 2 lookups on the device | Tier 2 snapshots kept in `storage.local` for seven days under salted-hash keys, capped at 5,000, switchable and clearable (salt rotates), none while Tier 2 is off; implements ADR-0018 Shape A; amends ADR-0012 |
| [ADR-0026](ADR-0026-hacker-news-adapter.md) | Hacker News adapter on the public Firebase API | Hacker News pulled into v1: a content script on news.ycombinator.com, Tier 0 from the `tr.athing` rows (no badge on the user page), Tier 2 from Firebase `user/<id>.json` on sight behind the shared limiter, four conservative `hn.*` features, one new host permission and none for Firebase, whose CORS admits the page; Reddit's wiring shared; amends ADR-0005 |
| [ADR-0027](ADR-0027-near-duplicate-reply.md) | Near-duplicate replies, scored per account from a per-page thread index | `thread.nearDuplicateReply` on X, Reddit, Bluesky and Hacker News at weight 1.5 in a new `coordination` group capped at 1.5, Tier 0: distinct other authors with an earlier reply whose word set has Jaccard ≥ 0.7; root, ancestors, a reply's parent and quoted text never sources; an in-memory per-page index fed at discovery, cleared on navigation, rescoring accounts when a later reply changes their count; Bluesky order from client-written TIDs |
| [ADR-0028](ADR-0028-reddit-karma-since-first-activity.md) | Reddit karma per day since first activity ships in v1, fetched on hover | `reddit.karmaSinceFirstActivity` (activity, 1.0, below the evasion document's 1.5, with a 7-day minimum span and a second caveat clause for history-wiped accounts) for accounts of 180 days or more whose `overview.json` listing is under 100 items, one Tier 2 request on hover only behind the shared limiter, kept as the oldest item's date and the item count for 24 hours as a separate persisted entry; the pipeline gains hover-only sources; fixtures hand-written until a recording exists; amends ADR-0020 and ADR-0025 |
| [ADR-0029](ADR-0029-shared-rare-domain.md) | Shared rare domains, scored per account from the per-page thread index | `thread.sharedRareDomain` on X, Reddit, Bluesky and Hacker News in the `coordination` group (feature cap 1.2, its largest bin; the group cap of 1.5 holds it with `thread.nearDuplicateReply`): distinct other authors who linked the same registrable domain earlier in the thread, not the counted-by-all definition the evasion pass proposed; a two-label public-suffix approximation, the Tranco top 1,000 (list GQ3QK, 2026-10-26), platform, shortener, archive and gif domains and the root's own domains excluded; Tier 0 from the page, Tier 1 on X from `TweetDetail` `expanded_url` joined by status id; per-post domains kept past in-place navigation, capped at 5,000 |
