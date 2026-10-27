# ADR-0026: Hacker News adapter on the public Firebase API

Status: Accepted · Date: 2026-10-26 · Amends ADR-0005

## Context

ADR-0005 put Hacker News in v1.1 and the roadmap called it a trivial adapter: the official API at
`https://hacker-news.firebaseio.com/v0/user/<id>.json` returns `created`, `karma`, `submitted` and
`about` for any account with no login, its documentation says "There is currently no rate limit"
([HackerNews/API](https://github.com/HackerNews/API)), and its CORS header admits the
`news.ycombinator.com` origin (docs/research/platforms.md). Complaints about AI-written comments from
new accounts on Hacker News in 2025–26 are anecdotal, and the site's policy is no bots, so the reader
interest is there while the cost is small. With the v1 platforms built and the shared on-sight wiring
already proven on Reddit, the adapter was pulled forward into v1.

Facts checked while building it, on 2026-10-26/27:

- Every page (front page, `/newest`, `item?id=` threads, `/newcomments`, `user?id=`) is server-rendered
  as a table of `tr.athing` rows and navigation is a full page load. A story's author sits in the next
  row's `.subtext`; a comment's in its own `.comhead`; the user page has a `tr.athing` with no
  `.comhead`. Recorded with `pnpm capture` under `tests/fixtures/hackernews/html/`.
- The page shows a username and nothing else about an account: no avatar, no join date, no counts.
  Hacker News has no follower graph and no suggested usernames.
- Usernames are case-sensitive: Firebase answers `null` for `camperbob2` and the account for
  `CamperBob2`.
- Firebase echoes any `Origin` in `access-control-allow-origin` and answers `*` without one, so a
  content-script fetch from the page works with no host permission. A live run of the built extension
  on the real site loaded 34 profiles across three pages with no failed request.
- 22 of 25 thread authors sampled had no `about` text.

## Decision

Ship a Hacker News adapter in v1, built like Reddit's: Tier 0 from the page, the Firebase user lookup
as the only source, fired on sight (ADR-0020) and cached 24 h.

- **Content script** on `https://news.ycombinator.com/*`, running the Reddit wiring, which moves to
  `src/platforms/onSightWire.ts` and takes the platform as a parameter rather than being copied.
- **Tier 0**: the author link (`a.hnuser`) of every story and comment row, with the handle's casing
  kept; a username whose last word is "bot" is a declaration. The account on its own user page gets no
  badge. The green name of a new account is not read until a recording shows one; `[dead]` and
  `[flagged]` are moderation outcomes, not evidence, and are not read.
- **Tier 2**: `GET /v0/user/<id>.json` with credentials omitted, behind the shared queue and limiter at
  the config's default (30 a minute, burst 10) although no limit is documented. A first-person "I am
  a … bot" in `about` is a declaration.
- **Features** (docs/scoring-spec.md, "Hacker News"): `hn.accountAgeDays`, `hn.karmaPerDay`,
  `hn.submissionsPerDay`, `hn.hasAbout`, with Reddit's prior and confidence weights and conservative
  weights: the karma rate at half Reddit's because one front-page launch earns a new account hundreds
  of points, and an empty about weighing nothing because most people leave it empty.
- **Policy and settings**: `hackernews` is a platform id like the others, so the signed policy can
  switch it or its Tier 2 off, lower its rate limit and adjust its weights, and the user has a toggle
  in the popup and options page. Its build defaults declare no Tier 1 (`t1: false`): the pages
  fetch no JSON of their own, so nothing could ever deliver it.
- **Manifest**: one new host permission, `https://news.ycombinator.com/*`. No host permission for
  `hacker-news.firebaseio.com`, following ADR-0013's rule for the Bluesky AppView.
- **Recording**: Hacker News needs no sign-in and has no humanity wall, so the pages were recorded with
  `pnpm capture --cdp` attached to a fresh Playwright Chromium instead of the user's own Chrome
  (ADR-0021). The rest of ADR-0021 applies unchanged. Because usernames are case-sensitive and can
  be two characters ("td", "by"), the anonymiser replaces them only where the site renders an
  account (profile links, `hnuser` text, the user page's title and `birth=` link, links to the
  account's own site), matching case exactly, and never in markup or comment prose; fake names and
  fake item ids are kept distinct within each recording.

## Consequences

- The manifest grows by one host, which is a store resubmission (ADR-0013 accepts this per platform);
  the listing gains a justification for it and names the Firebase request. The privacy page says the
  author's name goes to the official Hacker News API, without cookies.
- Reddit and Hacker News share one wiring: a fix there reaches both, and a test of either covers it.
- Every Hacker News badge depends on Firebase's CORS. If it stops admitting the page's origin, badges
  fall to No read; a host permission would not help a content-script fetch, so the fix would be a
  background fetch plus a `hacker-news.firebaseio.com` host permission and another resubmission
  (risk-register R-17).
- With Tier 2 off (conservative mode, policy) Hacker News badges read No read unless the username
  declares itself: the page alone has nothing to score.
- `policy/src/v1.json` does not list Hacker News; an omitted platform keeps its build defaults, and the
  next signed policy can add the entry.
- The smoke harness learns to serve a second host for an API with CORS, and to add a stylesheet to a
  recording that kept none.

## Alternatives considered

- **Read the user page (`/user?id=<name>`) instead of Firebase.** Same-origin and carries `created`
  and `karma`, but not the submission count, and it is HTML to parse and a page view per author on the
  site itself rather than a request to the API Hacker News publishes for this. Rejected.
- **Algolia's `hn.algolia.com/api/v1/users/<name>`.** Returns only username, karma and about, and its
  rate limit is unverified. Rejected.
- **Hover-only lookups, as on X and Bluesky.** The page has nothing else to read, so without on-sight
  lookups every badge would read No read until hovered, which is the problem ADR-0020 fixed on Reddit.
  The API is public and undocumented as limited, so the on-sight cost falls on no one's account.
  Rejected.
- **A `hacker-news.firebaseio.com` host permission.** Unneeded while CORS admits the page and useless
  for a content-script fetch if it stops; it would only widen the permission list. Rejected.
- **Wait for v1.1 as ADR-0005 planned.** The adapter is small, reuses the Reddit wiring and adds one
  host; holding it back bought nothing. Rejected.
