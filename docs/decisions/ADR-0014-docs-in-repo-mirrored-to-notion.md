# ADR-0014: Documentation canonical in the repo, mirrored to Notion

Status: Accepted
Date: 2026-10-22

## Context

The maintainer wants Botdar treated as a real project with a paper trail: product brief, design doc,
architecture doc, decision log, risk register, research, test plan and release checklist, plus a task
tracker. The maintainer's existing Notion workspace already uses a wiki database per project for docs
("Vocal Practice App") and a task tracker database with Task, Description, Priority, Status and Date
("SongMark Task Tracker", "BingoSlop task tracker"). Docs that live only in Notion are not reviewed
with the code and drift from it; docs that live only in the repo are harder to browse and lack a
tracker.

## Decision

- `docs/` in the repository is the canonical home for every written document, in Markdown, changed
  through pull requests. A PR that changes behaviour updates the relevant doc in the same PR
  (`CONTRIBUTING.md` states this rule).
- A **Botdar** wiki database in the maintainer's private Notion space mirrors each doc as a page, tagged
  by doc type, with a link back to the file on GitHub. Mirrors are refreshed by Claude at milestones
  (after each PR merges and at each checkpoint), not by automation.
- A **Botdar task tracker** database uses the same schema as the existing trackers plus a `Phase`
  select and a `PR` URL, is seeded from the implementation plan, and is updated as PRs open and land.
- A sync script is explicitly out of scope for the MVP.

## Consequences

- Reviewers can read the doc change beside the code change.
- Notion may lag the repo between milestones; the GitHub link on each page points at the truth.
- Manual mirroring is a recurring chore; if it becomes a burden, a `scripts/notion-sync.ts` is the
  obvious follow-up.

## Alternatives considered

- **Notion only.** Rejected: no PR review of docs, and they drift from the code.
- **Repo only.** Rejected: the maintainer wants the Notion hub and tracker they already use elsewhere.
- **Claude Docs.** Not chosen because the existing project convention is Notion.
