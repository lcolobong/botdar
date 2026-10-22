# Contributing

## Commits

- One logical change per commit. Each commit builds, typechecks and passes tests on its own.
- Production diff per commit (everything except tests, fixtures, snapshots, docs and assets) targets
  250 lines and never exceeds 400 without a justification in the message.
- Split by layer first (types, then engine or store, then UI), then by region. Leaf components land
  before the screen that composes them.
- Dependent commits that build one feature are prefixed `[k/n][Feature]`. Independent commits are not.
- Plain descriptive messages. No `feat:`/`fix:` prefixes.

## Pull requests

- Stacked PRs: each dependent PR is based on its parent's branch and says so. Merge with rebase only.
- The body has an overall Summary, then one section per commit with its own Summary and Test plan.
- Any commit that changes what a user sees carries before/after media in its test plan. A new element
  carries a rendered image.
- Review fixes amend the commit that owns the code, then force-push with lease. No "address review"
  commits.
- A PR that changes behavior updates the matching document in `docs/` in the same PR, and adds an ADR
  under `docs/decisions/` if it makes a decision.

## Code

- TypeScript strict. No `any` without a comment saying why.
- Names carry the meaning; comments carry only what the code cannot (a workaround, a trap, a
  deliberate tradeoff).
- Nothing about an account is written to persistent storage except user-initiated feedback.
- Every new signal source declares a tier and is reachable only through the policy merge.
- Parsers treat page data as untrusted: type guards, size caps, never throw.

## Fixtures

Recorded platform responses go under `tests/fixtures/<platform>/`. Run `pnpm fixtures:anonymize` before
committing; it replaces handles, ids and names with stable fakes.

## Docs and tracker

`docs/` is canonical. The Notion wiki is a mirror refreshed at milestones. Every PR has a row in the
Botdar task tracker; set it to Done when the PR lands.
