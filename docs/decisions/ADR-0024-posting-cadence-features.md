# ADR-0024: Posting-cadence features ship now, X passive only

Status: Accepted · Date: 2026-10-26

## Context

On 2026-10-26 the user asked for locale and post-timing signals. The adversarial-evasion pass of
2026-10-22 ([adversarial-evasion.md](../adversarial-evasion.md), 4.2 and 5) had already specified the
timing pair for v1.1: gap regularity (the coefficient of variation of the gaps between an account's
latest 100 posts) and the sleep window (the longest run of empty hours in its UTC hour-of-day
histogram), each on X and Bluesky. They are the behaviour that costs an operator most to change:
beating them means going quiet for hours every day and posting in bursts, which caps output per
account. Every v1 feature, by contrast, is an account attribute the operator controls or can buy.

The data was mostly in reach. On X the relay already allowlists `UserTweets` and
`UserTweetsAndReplies`, the profile timelines the page fetches when someone opens a profile, so the
posts' times arrive passively. Bluesky's public AppView serves `getAuthorFeed` with no auth and CORS
`*`, the same sanctioned read Tier 2 already makes for `getProfiles`. An active X request for a
timeline is another matter: ADR-0020 kept X's Tier 2 to the one hover-only About query because every
X request rides the user's session against an internal API with undocumented lock thresholds (R-05).
Reddit's twin (`comments.json`) was marked "after measuring" by the evasion pass.

The weights are uncalibrated, like every other feature's. The calibration plan in
[scoring-spec.md](../scoring-spec.md) and the validation plan in adversarial-evasion.md 6 have not run.

## Decision

The four features ship now at the spec'd weights: `x.gapRegularity` and `bsky.gapRegularity`
(`[0,0.5)→1.0`, `[0.5,0.8)→0.5`, else 0; gate 30 gaps over three days, gaps over seven days dropped)
and `x.noSleepWindow` and `bsky.noSleepWindow` (`[0,2)→1.0`, `[2,4)→0.5`, else 0; gate 100 posts
over seven days), each capped at 1.0, in a new `timing` group capped at 1.5 per platform. Accounts
verified as an organisation or a government are left out of timing.

- **X is passive only.** Post times come from the Tier 1 `UserTweets` bodies, the posts tab; the
  replies tab (`UserTweetsAndReplies`) is a different population and adds none. They belong to the
  user the request's `variables.userId` names, relayed with the body as the request's query string
  (the author with the most posts only when the request did not say). No active X request is added,
  so the features fire only for accounts whose profile the user has opened.
- **Bluesky makes one public request per hovered author.** A Tier 2 `getAuthorFeed` call (limit 100,
  `posts_and_author_threads`, the Posts tab) on hover, behind the existing limiter, 24-hour cache
  and Tier 2 policy switch, beside the batched `getProfiles`; the page's own `getAuthorFeed`
  responses feed Tier 1 only when they asked for the same filter, so the replies and media tabs
  never mix in. A Tier 2 set replaces a Tier 1 set, whose bodies the page controls. Times are the
  AppView's `indexedAt`, the record's client-written `createdAt` only without one, and nothing in
  the future counts.
- **A lookup is paid for whole.** It takes one limiter token per source up front, so it runs whole
  or not at all; one in which a call failed is scored but not cached, so the next hover asks again.
  The burst goes from 3 to 6 so three hovers in a row fit; sustained, the 30 tokens a minute become
  15 hovered authors a minute instead of 30, which is still more than a reader hovers, and the
  policy can lower it further.
- **Post times are never persisted.** The on-device cache of ADR-0025 stores profile fields only,
  so a hover answered by a stored snapshot still runs `getAuthorFeed`, alone, once per tab; the
  top-up is neither cached nor written back.
- **Declared accounts are left out of timing**, beside `org` and `gov`, since the declaration
  already decided their verdict.
- **Reddit is deferred** until its distribution has been measured, as the evasion pass said.
- **The weights stay restrict-able by policy** pending the calibration pass: a policy can lower either
  cap or zero either feature within a day, like any other.

## Consequences

- The cadence pair is the first behavioural evidence on the card ("Posts at regular intervals", why
  "scheduling tools post on a clock"; "Posts around the clock", why "no daily quiet window"), each
  with its own counter-case: publishing tools for the first, shared and team-run accounts for the
  second.
- As one independence group the pair can never satisfy the two-group rule for `many` (ADR-0003) on
  its own, and the 1.5 cap bounds what it adds to any read.
- Post times are a new kind of signal: `AccountSignals.postTimestamps` accumulates across responses
  within a tier instead of the newer body winning, while a higher tier's set still replaces a lower
  tier's; the pipeline normalises it once and the pipeline tests cover the rule. They stay in memory like every other field (ADR-0012).
- Bluesky adds one anonymous public request per hovered author to `public.api.bsky.app` (R-11).
- On X the features are rare in a feed: they need a profile visit, and 100 posts for the sleep window.
- Two request shapes are assumed, not recorded: that X's web client sends `UserTweets` as a GET with
  `variables` in the query, and that bsky.app's Posts tab asks for `posts_and_author_threads`. If
  either is wrong the passive path adds nothing (the owner falls back to the post count on X), and
  on Bluesky the hover lookup still supplies the times.
- We owe the calibration measurements in adversarial-evasion.md 6 (300 ordinary profiles per
  platform, journalists and news desks), the live recordings of a `UserTweets` and a public
  `getAuthorFeed` body that the parsers were built without, and a decision on Reddit after measuring.

## Alternatives considered

- **Ship at weight 0 until calibration.** Keeps the features in the build so a policy never has to
  enable them, but the user asked for the signals now, and nothing the policy cannot take back is
  gained by waiting: every weight can be lowered within a day.
- **Fetch X's `UserTweets` actively on hover.** Would make the X features fire for any hovered
  account, but it is a second session-attributed request per hover against the API whose lock
  thresholds are unknown, which ADR-0020 kept to the About query alone (R-05).
- **Reddit `overview.json` now.** A second Reddit request per author on sight for a feature the
  evasion pass explicitly left for after measuring; lurkers and burst posters there are not yet
  understood.
