# Handoff: where Botdar stands and what is left

Date: 2026-11-14. This is the pick-up-where-you-left-off page. It lists what is done, what only the
maintainer can do next, and what is parked. Update it whenever one of these items moves; the
[roadmap](roadmap.md) says *what* ships when, the [release checklist](release-checklist.md) says what to
check at ship time, and this page says *who is holding the ball right now*. Like every other doc it
is mirrored to the Notion wiki after each merge; the repo copy is canonical.

## Where things stand

- As of 2026-11-14 main holds PRs #1 to #50 (#50 is this page). Every PR from #23 on landed with a
  medium code review, a low follow-up review and CI matched to the merged SHA. Open PRs, if any, are
  at <https://github.com/lcolobong/botdar/pulls>.
- Adapters: X, Reddit, Bluesky, Hacker News and YouTube comment authors
  ([ADR-0030](decisions/ADR-0030-youtube-adapter.md)) all run on Tier 0 plus Tier 2, with Tier 1
  interception on X and Bluesky. One shared hover-card layer serves every platform (PR #48).
- Tooling: `pnpm capture` records live markup from a dedicated Chrome profile
  ([ADR-0021](decisions/ADR-0021-record-live-markup-before-building.md)); the popup carries a
  developer diagnostics section; `pnpm smoke` and `pnpm perf` run against the fixtures.
- The signed restrict-only policy file is served from GitHub Pages and verifies with
  `pnpm policy:verify` ([policy-ops.md](policy-ops.md)).
- Paper trail: product brief, design, architecture, scoring spec, 30 ADRs, risk register, test plan,
  release checklist, store listing draft. All mirrored to the Notion wiki; the Notion tracker has a
  row per stream.

To get back into it: `corepack enable` (the repo pins pnpm in `package.json`), `pnpm install`,
`pnpm build`, then load `.output/chrome-mv3` unpacked at `chrome://extensions`. `CONTRIBUTING.md` has
the commit and PR conventions.

## Needs the maintainer

Each of these is blocked on a decision or an action nobody else can take. Nothing below has code
waiting on it except where noted.

1. **Decide the YouTube "No read" wall.** YouTube exposes almost nothing per comment on sight and the
   channel lookup is hover-only, so nearly every comment shows a "No read" pill until hovered.
   On-sight lookups cost about 35 to 50 KB per typical commenter across the two requests, and up to
   about 1.9 MB for a large channel ([ADR-0030](decisions/ADR-0030-youtube-adapter.md)), which was
   ruled too heavy for every commenter on a page. Open a
   watch page with comments and decide: live with it, or add a YouTube-only rule that draws no badge
   until a read exists. The second is a small change in the shared wiring's drawable-tier gate.
2. **Record X, Reddit and Bluesky from the signed-in capture profile.** Run `pnpm capture:chrome`
   once, sign in, load the unpacked build, then `pnpm capture -- --url <page> --platform <p>
   --name <scene>` for each platform's feed and a thread. Review each anonymised file for leftover
   names before committing. These recordings unblock three things:
   - replacing the hand-written fixtures: none of the HTML fixtures under
     `tests/fixtures/{x,reddit,bluesky}/html/` is a recording (their headers say hand-written or
     hand-authored, or describe the shape without a recording date, as `x/html/timeline.html` does);
     only Hacker News and YouTube are recorded;
   - confirming the markup `GUESS`es (`grep -rn GUESS src/` is the inventory): Reddit comment flair,
     avatar, body and link-post attributes, X quoted and promoted posts, Bluesky thread reply markup,
     the YouTube creator chip, description wrapper and dark-theme attribute. The same grep also lists
     `GUESS`es about JSON shapes, in the X GraphQL parsers and the Bluesky XRPC filter, which an HTML
     recording cannot confirm: those need the matching responses saved from the DevTools Network
     panel of the capture profile and dropped beside the existing JSON fixtures;
   - the two remaining countermeasures: `x.agedRepurposed` needs About-page recordings, and
     `reddit.gapRegularity` needs a measurement run over recorded overviews
     ([roadmap.md](roadmap.md#v11)).
3. **Supply calibration ground truth.** Roughly 200 accounts across the platforms, each labelled bot,
   human or declared, so the weights and the two bucket thresholds in
   [scoring-spec.md](scoring-spec.md) can be checked against something other than judgment. The
   starting point recorded in [research/reddit-bot-prevalence.md](research/reddit-bot-prevalence.md)
   is r/SubSimGPT2Interactive (all bots by construction) against r/politics; X and Bluesky still need
   a labelled set of their own. The spec's "Calibration plan" section describes the v1 pass: a
   dev-only logging flag that records feature vectors and verdicts for about 200 accounts seen while
   browsing normally, then a review of the tier distribution and every top-tier verdict by hand. That
   flag is not built yet; the popup's diagnostics section is the nearest existing hook. Until the pass
   is done, every weight in the spec's "Default feature tables" is the uncalibrated starting point it
   says it is.
4. **Chrome Web Store business.** Register the developer account and pay the one-time fee, decide
   where the privacy policy is hosted (the draft assumes the GitHub Pages site that already serves
   the policy file), and confirm the privacy-form answers in [store/README.md](../store/README.md):
   Website content yes, User activity no, nothing sold or shared. Firefox AMO follows the same
   listing with a source archive.
5. **Run the live check per platform** from [test-plan.md](test-plan.md#live-check-per-platform-pr)
   on the release build, with anchor misses at zero in the popup diagnostics. The Notion tracker's
   "Validate" rows for X and Bluesky are these checks.
6. **Branding.** "Botdar" is a working title. The name appears in the manifest, the store listing,
   the badge tooltip and the docs; the release checklist asks that the manifest name and the listing
   match, so settle the name before the first submission.

## On hold by decision

- **Mastodon adapter** (roadmap v1.2) and the **Safari Web Extension wrapper**: parked on
  2026-10-28 by the maintainer. Do not start them until they say so.
- **Threads**: conditional on a legal review ([ADR-0005](decisions/ADR-0005-platform-roadmap.md)).
- **Shared Tier 2 cache and any cloud layer**: deferred with conditions in
  [ADR-0018](decisions/ADR-0018-no-shared-cache-yet.md).

## Release path once the above is done

Bump the version (the repo is at 0.0.1), run the [release checklist](release-checklist.md), tag the
release, submit to the Chrome Web Store, then Firefox AMO. The checklist's "Chrome Web Store submission" section already lists the reviewer-facing
justifications that need to be ready, including the one for MAIN-world fetch interception.

## Standing process rules

These are the conventions every PR in the repo has followed; keep to them so the history stays
reviewable.

- Rebase merges only (`gh pr merge <n> --rebase --delete-branch`); stacked PRs retarget to main
  before the parent merges and rebase after each merge.
- Every PR gets a code review and CI matched to the tip SHA before it merges. Review fixes amend the
  owning commit; no "address review" commits.
- Record live markup before building against it, and give every fixture a header that says recorded
  or hand-written and when ([ADR-0021](decisions/ADR-0021-record-live-markup-before-building.md));
  `x/html/timeline.html` and `bluesky/html/feed.html` predate the rule and still owe that line.
- Docs are canonical in `docs/` and mirrored to the Notion wiki after a merge; decisions go in
  `docs/decisions/` as ADRs.
- User-visible changes carry before/after media in the PR's test plan.
