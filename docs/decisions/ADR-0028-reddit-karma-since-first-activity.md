# ADR-0028: Reddit karma per day since first activity ships in v1, fetched on hover

Status: Accepted · Date: 2026-10-27 · Amends ADR-0020, ADR-0025

## Context

`reddit.karmaPerDay` is gated to accounts under 180 days old, because on an older account years of
ordinary use dilute the rate until it says nothing (docs/scoring-spec.md, "Activity rate"). The gate
is also the evasion: an operator who buys or ages an account past 180 days is never rate-checked
(docs/adversarial-evasion.md, section 4.4). Resellers do not delete the join date, but the account's
visible history starts when it was first used, so the same karma divided by the days since that first
item is the rate the gate hides. The evasion document listed `reddit.karmaSinceFirstActivity` sixth in
its v1.1 order and `reddit.dormancyGap` as a reason line only.

What the repository could confirm while building it, on 2026-10-27:

- `GET /user/<name>/overview.json?limit=100` is the public listing of a user's latest posts and
  comments, newest first, each item carrying `created_utc`; `data.after` points at the next page and
  `data.dist` counts the items. A listing shorter than the page is the whole visible history, so its
  last item is the account's first.
- No recording of an `overview.json` response exists in the repository. The fixtures under
  `tests/fixtures/reddit/overview/` are hand-written in that documented shape and say so in their
  `_fixture` field. What a hidden-history profile returns (an empty listing, a 403 or a 404) is not
  verified; the code treats an empty listing and a 404 as "nothing visible" and a 403 as a
  logged-out session, as `about.json` does.
- The lookup path ADR-0025 persists is one snapshot per account, written when the on-sight lookup
  delivers. A hover that wanted a second request's answer in that snapshot would find the snapshot
  already there and never ask.

## Decision

Ship `reddit.karmaSinceFirstActivity` in v1, with the spec in docs/adversarial-evasion.md and
docs/scoring-spec.md:

- **Feature**: group `activity`, cap 1.0, value `(linkKarma + commentKarma) / days since the oldest
  visible item`, bins `[0,50)→0` `[50,200)→0.4` `[200,1000)→0.7` `[1000,∞)→1.0`. Gate: account age of
  at least 180 days, so it is the complement of `reddit.karmaPerDay` and the two never both fire (the
  independence rule of ADR-0003); a listing under 100 items; an oldest item at least 7 days old, which
  also leaves a hidden profile (no items) out. A listing that points at a next page reports the page size, so it fails the
  gate however few items it carried.
- **Source**: Tier 2, `overview.json?limit=100` with the user's cookies, on hover only, behind the same
  limiter as `about.json`. 429 handling (`retryAfterMsFrom`) and the logged-out answers are shared with
  `about.json` (`redditJson.ts`); a login wall is left to `about.json`'s pause and also stops the
  hover request. The request is skipped when `about.json` has not shown an account of 180 days or
  more, because the answer could not be used.
- **What is read and kept**: only each item's `created_utc` and the item count, through the shared
  untrusted-JSON readers. The snapshot holds the oldest timestamp and the count (`oldestItemAt`,
  `visibleItemCount`); no title, body, subreddit or id is read, so none can be stored (ADR-0025).
- **Pipeline**: a source can be `hoverOnly`. On-sight lookups leave it out; a hover runs it after the
  account's main lookup has settled, so an account looked up on sight still gets it. It has its own
  memory cache entry and its own persisted entry (a facet of the account's lookup, under a separate
  salted key) with a 24-hour life, against seven days for the profile snapshot. A failed, empty or
  rate-limited request is not cached and the next hover asks again (PR #34's rule); a rate limit
  also opens the shared circuit. A 401, a 403 or a login page trips the same ten-minute pause
  `about.json` uses and is not cached (so a cached profile does not leave every hover spending a
  token on a login wall); a 404 means there is no listing to read and is kept as an empty one for
  the day. The sweep drops a
  facet at its own lifetime, so a dead one takes no capacity from a live profile snapshot.
- **Policy**: the source is Tier 2, so the signed policy's Tier 2 restriction and conservative mode
  stop it as they stop `about.json`; with Tier 2 off the feature is never emitted.
- **Wording**: "~120 karma/day since first activity 3 months ago" (or "today" under a day), the karma
  clauses of `reddit.karmaPerDay`, and the caveat "Long-time readers who start posting in large
  communities can earn karma quickly. Accounts that delete their old posts keep their karma, so the
  rate can look inflated." (ADR-0022).

### Deviations from docs/adversarial-evasion.md

Review found that Reddit keeps karma after a user deletes the posts and comments that earned it, so an
account that ran a history wiper and posted a few comments last week shows its whole karma over a few
days, and the data cannot tell it from a farmed account. Three changes follow, and the evasion
document's row and the scoring spec are updated to match:

1. **Minimum span of 7 days** (the document had no such gate). Karma over a shorter span is too thin
   to call a rate, and it removes the "0 days ago" case.
2. **Cap 1.0 with bins scaled to it** (`0`, `0.4`, `0.7`, `1.0`), where the document gave 1.5 and the
   bins of `reddit.karmaPerDay`. The counter-case looks identical to the evidence in the data, so
   the feature weighs less than the young-account rate whose gate cannot be gamed this way.
3. **A second caveat clause**, "Accounts that delete their old posts keep their karma, so the rate
   can look inflated.

## Consequences

- One more request per hovered Reddit account, and only for accounts of 180 days or more. The
  privacy page and the store's storage note say the extension also asks Reddit for that listing on
  hover and keeps two dates and a count for a day.
- The reason is evidence of what the first visible item's date implies, not of what the account did
  before it: an account that cleared its history looks younger than it is, which only makes the
  rate higher, and a long-time reader who starts posting in a large community earns karma quickly.
  The cap of 1.0 is enough with a second group to reach "Unsure" and not enough alone for
  "Likely bot".
- Hand-written fixtures mean the parser and the empty-listing behaviour rest on the documented shape.
  A recording of a normal, a hidden and a very active user is a Validation item before the feature's
  weight is trusted past this release.
- `pipeline.ts` grows (it was over 300 lines already); the hover-source methods are the first piece
  to move if the file is split.

## Alternatives considered

- **Fetch it on sight with `about.json`.** A second request per author for every post on screen, for
  a feature that only matters on aged accounts and only once the card is opened. Rejected; ADR-0020's
  on-sight cost was justified for one request.
- **Store it inside the profile snapshot.** The snapshot is written once, at the on-sight lookup, with
  a seven-day life, so a hover could not add to it without rewriting it, and the two numbers would
  outlive their useful day. Rejected for a separate 24-hour entry.
- **Fetch more than one page to see every item.** Costs a request per page and gives the same answer
  for the accounts that matter (a first-visible item inside a page). A 100-item listing is treated as
  "not the whole history" and the feature is omitted. Rejected.
- **Keep the evasion document's cap of 1.5 and the bins of `reddit.karmaPerDay`.** A history-wiped
  account is indistinguishable from a farmed one in the data, and no calibration exists for aged
  accounts. Rejected until a recording and a measurement say otherwise.
