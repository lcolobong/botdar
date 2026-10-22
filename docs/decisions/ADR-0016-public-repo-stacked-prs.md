# ADR-0016: Public repository, stacked PRs, rebase-merge, bounded commits

Status: Accepted
Date: 2026-10-22

## Context

Botdar is a free public product whose trust story is "nothing leaves your browser". An open repository
lets anyone verify that. GitHub Pages hosts the policy file (ADR-0007) and is free only for public
repositories on a free plan. The maintainer's working conventions across projects call for small,
atomic, individually buildable commits, stacked pull requests with before/after media for anything
user-visible, and linear history.

## Decision

- The repository `lcolobong/botdar` is public from the first commit. Visibility can be changed later
  if a reason appears.
- Work lands as stacked PRs in dependency order, each PR a short stack of atomic commits, merged with
  "Rebase and merge". `deleteBranchOnMerge` is on so child PRs retarget automatically.
- A commit's production diff (excluding tests, fixtures, snapshots, docs and generated assets) targets
  250 lines and never exceeds 400 without a justification in the message. Split by layer first (types,
  then engine, then UI), then by region. Leaf components land before the screen that composes them.
- Dependent commits in one feature carry `[k/n][Feature]` prefixes; independent commits do not. No
  conventional-commit prefixes.
- Review fixes amend the owning commit and force-push with lease; no "address review" commits.
- Every user-visible commit carries before/after media in its PR section; a new component shows a
  rendered image.
- Each PR body has an overall Summary, then one section per commit with its own Summary and Test plan.

## Consequences

- History reads as a sequence of small reviewable steps; `git bisect` works.
- More PRs and more force-pushes; the discipline costs time and buys reviewability.
- Private keys, personal fixtures and session data must never enter the repo; `.gitignore` and the
  fixture anonymizer script enforce that.

## Alternatives considered

- **Private repo.** Rejected: weaker trust story and GitHub Pages would need a paid plan.
- **One large MVP PR.** Rejected: unreviewable, and it defeats the commit-size discipline.
- **Squash merges.** Rejected: destroys the atomic commit structure the stack was built for.
