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

- Recorded platform responses and pages go under `tests/fixtures/<platform>/`.
- **Record before building.** The first commit of a platform adapter, or of a new surface on an
  existing platform, is a recording of the live page made with `pnpm capture` (see
  `scripts/capture/run.ts` and [ADR-0021](docs/decisions/ADR-0021-record-live-markup-before-building.md)).
  A selector that no recording has confirmed is marked `GUESS` in the code with what was assumed.
- Every HTML fixture header says whether it is a recording or a hand-written snippet, the URL shape
  it came from and the date. Hand-written snippets cover edge cases; they never stand in for a
  surface that has not been recorded.
- `pnpm capture` anonymises as it records; `pnpm fixtures:anonymize -- <file> --platform <p>` does
  the same for a file you already have. Both replace usernames, ids and avatar paths with stable
  fakes and leave display names and post text for you to read before committing. Raw captures live
  under `.output/capture/`, which git ignores; never copy one into the repo.
- A PR that changes what a platform shows records a live check by the maintainer in its test plan
  (test-plan.md "Live check per platform PR"), done or skipped with the reason.

## Docs and tracker

`docs/` is canonical. The Notion wiki is a mirror refreshed at milestones. Every PR has a row in the
Botdar task tracker; set it to Done when the PR lands.
