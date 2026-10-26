# ADR-0020: Badge on every account

Status: Accepted, amended by ADR-0022 (a Likely human card's caveat names a counter-case for its strongest ordinary evidence) · Date: 2026-10-25 · Amends ADR-0017

## Context

ADR-0017 chose a quiet feed: no badge for an account that looks fine (typical, unless the user turned
"Show Likely human" on) and none for an account with too little data (unknown). When the user tested
the build on live Reddit they saw no badges at all. Reddit's page carries almost nothing about an
author, its Tier 2 `about.json` lookup ran only when a badge was hovered, and with no badge there was
nothing to hover, so the lookup never ran and every author stayed typical or unknown. A reader could
not tell whether the extension was running.

The user decided on 2026-10-25: "the badges now need to be on even if they're likely human and we
should also give reasons for why we think someone is a real user. Also ... we maybe need some sort of
loading indicator for the badges". And later: "if someone is unknown we show no badge. I think we
should show something, so the user knows that the user has been analyzed and that it's just unclear".

A run on r/SubSimGPT2Interactive, a subreddit of self-declared GPT-2 bots, showed the other side: with
only the page's data, Reddit's one Tier 0 non-signal (a username outside the suggested pattern) plus
the low prior scored typical, which a default-on Likely human badge would have printed on obvious
bots.

## Decision

Every account near the viewport carries a badge, and a Likely human badge has to be earned and
explained.

- **Likely human is on by default.** The "Show Likely human" setting stays, as the way back to a feed
  that only marks accounts worth a look. Labels and label styles (plain, Sus scale, icon only) are
  unchanged.
- **Likely human is earned.** A typical result is reported as typical only at confidence ≥ 0.5 and
  with at least two worded evidence items outside the handle group; otherwise it is unknown. Every
  adapter scores the handle's shape from the name on the post, so handle evidence never counts, and
  an item whose template has nothing to say (an absent pattern) does not count either, so a Likely
  human card always lists at least two reasons. An item that points towards automation ("Joined 6
  weeks ago", "Default avatar") does not count, so a young account with a default avatar that stays
  under the Unsure threshold reads No read rather than a card saying it looks ordinary; neutral
  observations ("Custom avatar", a karma split) do count. On Reddit the confidence bar means a Tier 2 lookup
  delivered. Unsure, Likely bot and Declared bot are unaffected. The constants sit next to the `many`
  gate in `src/core/scoring/engine.ts`; docs/scoring-spec.md step 7 has the rule.
- **The Likely human card gives factual reasons.** Templates word evidence that points towards an
  ordinary account ("Account is 9 years old", "Custom avatar", "Verified email", "Followed by 900,
  following 120") and say nothing for a pattern that is absent. The card closes with "These signals
  look like an ordinary account; nothing here is proof." instead of a suspicion caveat. It never says
  "verified human", and no reason line says "bot".
- **An unknown verdict draws a No read badge** instead of nothing: hollow, in the neutral unknown
  tokens, with a question-mark glyph; "Who dis" on the Sus scale. Its card says why there is nothing to
  read (lookups off by conservative mode or a policy pause, a login wall, nothing returned, or not
  looked up yet) and shows no confidence note, caveat or "This looks wrong", because it claims nothing.
- **Loading is visible.** While an account's Tier 2 lookup is queued or running an unknown badge
  reads "Checking" until the lookup settles. On X and Bluesky that covers the hover lookup and the
  glyph pulses. On Reddit it covers the time from mount, and the glyph is held still and dimmed
  except on the badge under the pointer, because many pulsing badges at once dropped frames while
  scrolling at 4x CPU throttling.
- **Reddit looks authors up on sight.** The about.json lookup runs when a post is attached, which
  ADR-0019 limits to posts within a screen of the viewport: once per author per page, from the 24 h
  in-memory cache when it can be, otherwise through a first-in, first-out queue that waits for the
  rate limiter (30 a minute sustained, from the config; burst raised from 3 to 10). It never runs
  while Tier 2 is off (policy or conservative mode) or after a logged-out answer; turning Tier 2 back
  on looks up the authors already on screen. A hover still works, jumps the queue and is normally a
  cache hit.
- **X and Bluesky stay hover-only for Tier 2.** X's AboutAccountQuery is an extra request attributable
  to the user's session against an internal API with undocumented lock thresholds (R-05), and X is the
  platform ADR-0005 and ADR-0006 single out for platform pressure; firing it for every author on
  screen is the riskiest traffic pattern the extension could add. It is also not needed: X's Tier 1
  timeline objects already carry join date, counts, avatar, bio and verification for every author, so
  the on-sight read is rich without a lookup. On Bluesky, Tier 1 feed objects carry join date, avatar
  and labels; getProfiles batches up to 25 actors per request, but the limiter counts one token per
  account rather than per request, so on-sight lookups there need per-request accounting first. That
  is a follow-up, not part of this decision.

## Consequences

- The feed is no longer quiet: every author carries a badge, most of them Likely human or No read.
  Likely bot and Unsure no longer stand out by rarity, so they rely on colour and glyph, which
  docs/design.md already requires to differ by more than hue. The quiet feed for typical accounts is
  one toggle away; No read badges have no toggle.
- **Tier 2 traffic to Reddit rises.** Before, a Reddit reader sent an about.json request per hovered
  author. Now the extension sends about one per distinct author that comes within a screen of the
  viewport, at most 30 a minute after a burst of 10, cached for 24 h per tab. A busy thread read top to
  bottom can reach that ceiling; past the burst, badges catch up at one author every two seconds. These
  are small same-origin GETs on the user's own session. The risk register's R-05 row records the new
  trigger.
- **The kill switch still applies.** The signed restrict-only policy (ADR-0007) can lower Reddit's
  `rateLimitPerMinute` or turn its Tier 2 off for every install within a day of a policy push; with
  Tier 2 off the queue is dropped and every author falls back to the Tier 0 read: Declared bot or
  Unsure where the page itself shows it, otherwise No read with "Profile lookups are off", since the
  page alone cannot earn Likely human under the rule above.
- **On Bluesky many authors read No read until hovered.** Its Tier 1 feed objects alone rarely give
  two worded reasons (the smoke fixture's ordinary author, Likely human before the rule above, reads
  No read after it), and getProfiles still runs on hover only. On-sight batched lookups there,
  once the limiter counts per request, are the follow-up that turns those badges into reads.
- Logged-out Reddit readers send at most a burst of requests before the first logged-out answer pauses
  the source; they see No read with an explanation, since the page alone cannot earn a read.
- Every account mounts a badge, so badge mount cost matters more; docs/performance.md, "Badges on
  every account", measures it on the fixtures.
- Settings saved before this change keep `showLikelyHuman: false` if the user ever saved the options
  page; there is no migration, since the extension has not been released.

## Alternatives considered

- **Keep the quiet feed and only fire Reddit lookups on sight.** Still leaves most authors without a
  visible read, which was the complaint, and gives no sign that an account was analysed.
- **Label every typical verdict Likely human.** Shown on r/SubSimGPT2Interactive to print Likely
  human on self-declared bots.
- **Fire Tier 2 on sight on X and Bluesky too.** Not needed on X given Tier 1, and the highest
  platform-pressure risk; on Bluesky blocked on the limiter's per-account accounting.
- **Drop on-sight lookups the limiter refuses instead of queueing them.** A thread puts more authors
  on screen than the burst, and the rest would never be read without a hover.
