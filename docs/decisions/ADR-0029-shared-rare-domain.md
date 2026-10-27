# ADR-0029: Shared rare domains, scored per account from the per-page thread index

Status: Accepted · Date: 2026-10-27

## Context

The adversarial-evasion pass ([adversarial-evasion.md](../adversarial-evasion.md), 4.1 and 5) ranked
`thread.sharedRareDomain` second among the local coordination signals: fox8's strongest tell was many
accounts linking the same small site, and making an operator spread its links across more domains
means registering and warming each one. The pass specified the numbers (coordination, bins `[0,3)→0`
`[3,5)→0.8` `[5,∞)→1.2`; distinct authors linking the same registrable domain, excluding a built-in
top ~1,000 domains and the parent's own domain; the domain must be resolved, which on X needs the Tier 1
`expanded_url` because the page shows only t.co) and listed it with a cap of 1.5.

Facts that shaped the build, checked on 2026-10-27:

- [ADR-0027](ADR-0027-near-duplicate-reply.md) already keeps a per-page index of thread replies fed at
  discovery, appends page evidence to each adapter's `toFeatures` through
  `PageThreads.withPageEvidence`, and rescores accounts on screen through `onEvidenceChanged`.
- X's DOM renders every link as `t.co`. The passive Tier 1 source already parses `TweetDetail`
  bodies, whose post objects carry `legacy.entities.urls[].expanded_url`. Those bodies arrive by
  status id, before or after the replies render, and X does not fetch them again when the page
  returns to a thread or opens a photo over it.
- Reddit, Hacker News and Bluesky render absolute links in the page. Only Hacker News has a recorded
  thread (`tests/fixtures/hackernews/html/thread.html`); Reddit's `shreddit-post` `content-href` and
  text-body slot and Bluesky's link card are guesses (ADR-0021).
- The full Public Suffix List is about 10,000 rules and 200 KB.

## Decision

Ship `thread.sharedRareDomain` on X, Reddit, Bluesky and Hacker News in the `coordination` group with
the spec'd bins, Tier 0 where the page shows the links and Tier 1 on X, scored per account from a
second index beside the near-duplicate one.

- **Value.** The number of *distinct other authors* with a reply earlier in the same thread linking
  the same registrable domain as one of this account's replies, never the reply's own parent; the most
  over the account's replies and their domains. Omitted when none of the account's replies on the page
  links a domain that counts.
- **Earlier linkers only, a departure from the pass.** The pass counted every other linker. Counting
  only earlier ones follows ADR-0027's earliest-author rule: a real person who linked their own small
  site cannot be flagged by accounts that link it after them, and the evasion pass's validation plan
  already requires that poisoning leaves the original author's read unchanged. The cost is that the
  first three accounts of a campaign never score, so the feature catches a campaign from its fourth
  account (0.8) and its sixth (1.2). A tie in time counts for neither.
- **Feature cap 1.2, not 1.5.** The bins never exceed 1.2, so a cap of 1.5 would never bind; every other
  feature's cap is its largest bin. The 1.5 that matters is the `coordination` group cap, which now
  holds this feature and `thread.nearDuplicateReply` together, so the two alone stay below `some`
  (prior −2.5 + 1.5 gives p ≈ 0.27 on X and Bluesky). A reply counted here can also count as a near
  duplicate; ADR-0003's independence rule is about groups, and both are one group.
- **Which domains count.** A link's registrable domain is its last two host labels, or three under one
  of 30 multi-label country suffixes (`co.uk`, `com.br`, `co.jp`, and every other one the bundled list
  uses), lowercased, with `www.` and other subdomains falling away (`src/core/links/`). This
  approximates the Public Suffix List rather than vendoring it: a hosting suffix it does not know
  (`<blog>.github.io`, `<site>.blogspot.com`) folds into one domain, which can miss a rare domain but
  never invent one. Excluded: the top 1,000 of the Tranco list GQ3QK (generated 2026-10-26 from the
  30 days before it, combining the Chrome UX Report, Farsight, Majestic, Cloudflare Radar and Cisco
  Umbrella; https://tranco-list.eu/list/GQ3QK), bundled as `topDomains.json`; the four platforms' own
  domains; link shorteners, archive mirrors and gif pickers outside the top list (one shortener
  domain stands for every destination, and threads about a paywalled story fill with archive links);
  and every domain the thread's root post links, since replies discussing a story link its site.
- **Roots.** Each platform's reader also reads its thread's root for links: a Reddit link post's
  `content-href` and its text body (read again on a later pass while neither is in the DOM, so the
  post's own site is not settled as linking nothing), a Hacker News head item's title link, comment
  text and Ask text, the Bluesky root item's links, and on X the expanded links of the status the URL
  names. A Bluesky reply with neither text nor a link has not finished rendering and is read again
  later too.
- **X keyed by status id.** The passive GraphQL source hands each `TweetDetail` post's expanded links
  (at most ten, a long post's `note_tweet` entities a guess) to the adapter's `PageThreads` by status
  id; the DOM reader records the reply's place under the same id, and the index joins the two in either
  order. The links reach the index only while the Tier 1 source runs, so with Tier 1 off by policy or
  conservative mode the feature never fires on X. An X reply with no text (X hides a lone link behind
  its card) is now recorded as a reply. The alternative of reading only links whose DOM text shows the
  domain was not needed.
- **What the index holds.** Each reply's place (author, id, parent, time), cleared on navigation like
  ADR-0027's index, and the registrable domains of each post (by post id) and of each thread's root
  (by thread key, in a map of its own so a busy page's posts never push a thread's own site out),
  never a link's path. The domains are kept past an in-place navigation, each map capped at 5,000
  with the oldest dropped, because X does not fetch a thread again when the page returns to it; a page
  load clears everything. A reply whose domains are dropped leaves the count entirely, for its own
  author and for later linkers alike. Nothing is persisted and no request is added.
- **Weights restrict-able by policy**, like every feature, pending calibration.

## Consequences

- The card gains "Links a site {n} other accounts linked earlier in this thread", why "networks push
  one site from many accounts", and the feature's own counter-case "People discussing the same story
  often share the same link." On the hand-written Reddit scene a two-week-old account that is the
  sixth to link one small site goes from Likely human to Unsure.
- A thread about one niche site (a local paper's story discussed under a different post, a project's
  docs) can fire for its later linkers; the root exclusion covers the common case, and the bins start
  at three earlier authors.
- Bundled size grows by the 1,000 domains (about 15 KB in each content script). Discovery reads each
  reply's links once with its text; `pnpm perf` was not rerun for this change.
- We owe the calibration in adversarial-evasion.md 6 (fires per thread on the same 100 threads per
  platform, and which domains the list misses), recordings of Reddit and Bluesky thread pages to
  confirm `content-href`, the text-body slot and the link card (and whether a Bluesky quoted post's
  links are told apart), a recorded `TweetDetail` body with links, and a refresh of the top-domain
  list when it is calibrated.

## Alternatives considered

- **Count every other linker** (the pass's definition). Flags every account of a campaign once four
  have linked, the first three included, but lets accounts flag a real person by linking their site
  after them. Rejected for
  the earliest-author rule.
- **Vendor the Public Suffix List.** Exact, at 200 KB and a refresh duty, for cases (hosting suffixes)
  where the approximation errs only towards missing. Rejected.
- **Clear the X link store on navigation with the rest of the page.** The observer notices an in-place
  navigation lazily, so the next thread's `TweetDetail` body could arrive first and be wiped, and a
  photo opened over a thread would erase links X never sends again. Rejected for the capped store.
- **Only count X links whose rendered text shows the domain.** No Tier 1 needed, but X truncates and
  hides link text (a card replaces a lone link), so most links would be missed. Not needed once the
  status-id join worked.
