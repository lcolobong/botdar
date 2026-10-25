# ADR-0021: Record live markup before building on it

Status: Accepted · Date: 2026-10-25 · Amends ADR-0016

## Context

The first manual test of the extension on live Reddit (2026-10-25) showed no badges at all. The
Reddit HTML fixtures had been written by hand from documentation and memory: they used relative
author links where the live post page writes absolute ones, and they slotted a comment's author
row as a direct child where the live page nests it inside `details > summary`. Nineteen PRs of UI,
tests and media had been built on those fixtures, the test plan described them as recordings, and
the day-one validation that would have caught it ("confirm the shreddit author-anchor location")
was deferred and then skipped. Finding the cause took a day of DevTools console pastes, because
Claude in Chrome refuses reddit.com and Playwright from a fresh profile meets Reddit's humanity
wall. The retrospective is in the PR that carries this ADR; the tooling it produced is `pnpm capture`
([scripts/capture/run.ts](../../scripts/capture/run.ts)) and the popup diagnostics panel.

## Decision

- **A platform adapter starts from a recording.** The first commit of any platform adapter, and of
  any new surface on an existing platform (a thread page, a profile page, old Reddit), is an
  anonymised recording of the live page made with `pnpm capture`. A selector that has not been seen
  in a recording is marked `GUESS` in the code with what was assumed, and the release checklist
  requires every remaining `GUESS` to have a tracker row.
- **Fixtures say what they are.** Every HTML fixture header states whether it is a recording or a
  hand-written snippet, the URL shape it came from (ids and handles scrubbed) and the date. A
  hand-written fixture is for an edge case the recordings do not show; it never stands in for a
  surface that has not been recorded.
- **Recording uses the user's own Chrome.** The capture script attaches over the DevTools protocol
  to a Chrome the user runs on a dedicated profile with their own sign-ins and the extension
  loaded. Chrome 136+ ignores the debugging port on the default profile, so the dedicated profile
  is a requirement, not a preference. The port is open only while recording.
- **Raw and anonymised are kept apart.** The raw page, with real usernames, is written only under
  `.output/capture/`, which git ignores. The anonymised page goes under `tests/fixtures/` with a
  header stating what was and was not anonymised, and a person reads it before it is committed.
  Fakes keep the shape the scoring features read (generated names stay generated, name-plus-digits
  handles keep their digits) so a recording scores the way the live page did.
- **Each platform PR carries a live check by the user.** Before a PR that changes what a platform
  shows is merged, the user loads the build and runs the two-minute check in the test plan (feed,
  thread, comments, hover), and the PR test plan records it as done or skipped with the reason.
- **Day-one validations are tracked tasks.** Each one is a Notion tracker row that blocks the
  adapter PR; skipping one is a visible decision with a reason, not an omission.

## Consequences

- The Reddit, X and Bluesky fixtures are re-recorded with the script and the hand-written pages are
  reduced to edge-case snippets (follow-up PRs; the test expectations change with the fake handles).
- The release checklist gains a re-recording step per platform and the `GUESS` audit.
- A contributor without the user's sign-ins cannot record; they open a PR with the `GUESS` marker
  and the maintainer records before merging.
- The extension's popup gains a diagnostics section (developer setting) with per-page counts and a
  snapshot export, so a failure like this reads as "12 seen, 0 badged, 12 anchor misses" instead of
  "no badges", and a page that the script cannot reach can still be exported from the browser.
