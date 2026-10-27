# Design

Date: 2026-10-22, badge states amended 2026-10-25 (ADR-0020), card copy amended 2026-10-25 (ADR-0022), card
strength and disclosure amended 2026-10-26 (ADR-0023) ·
Status: approved after one review round · Design system: https://claude.ai/artifact/2jacALGXFe96ubLp62qRAe ·
Project canvas: https://claude.ai/artifact/AM2UKsqdyJU7qy919pPFAe (the "Project" page has every surface's
mockups; the "Hover card explorations" page has the card alternatives A–D and the disclosure variants
P1–P3)

## Principles

1. Every account is visibly analysed. Each author near the viewport carries a badge: a read when there
   is one, "No read" when there is too little to go on, "Checking" while the profile is loading. A
   Likely human badge is earned by the data, not given by default (amended by
   [ADR-0020](decisions/ADR-0020-badge-on-every-account.md); the quiet feed of ADR-0017 is one setting
   away for Likely human).
2. Plain words on the badge, facts and reasons on the card. The badge says "Likely bot" or "Unsure"; the
   hover card lists two to four observations with numbers and dates under "Why it leans this way", each
   with how strong a flag it is and the way it points, keeps a short clause on why each one counts
   one click away, and ends under "Why this could be wrong" with the case against the read (amended
   by [ADR-0022](decisions/ADR-0022-reasons-say-why.md) and
   [ADR-0023](decisions/ADR-0023-strength-scale-and-progressive-disclosure.md)). A Likely
   human card lists what looks ordinary ("Account is 9 years old", "Custom avatar") and says how an
   automated account could look the same; a No read card says why there is nothing to read and claims
   nothing.
3. Never hide a post.
4. Honest about uncertainty: a hollow badge when fewer than half the data sources delivered, a dashed
   badge when lookups are paused.
5. Fit the host. The badge borrows the host font and sits inline with the handle at the host's density,
   and follows the host's light or dark theme.

## Badge set (decision from the review)

| Internal tier | Plain label (default) | Sus scale label | Icon | Shown by default |
|---|---|---|---|---|
| many | Likely bot | Sus | red-eyed bot head | yes |
| some | Unsure | Kinda sus | outlined bot head with a question mark | yes |
| declared | Declared bot | Honest self-report bot | tag | yes |
| typical | Likely human | Real af | person | yes; setting "Show Likely human" turns it off |
| unknown | No read | Who dis | question mark, hollow and neutral | yes, always |

While an account's lookup is queued or running, an unknown badge reads "Checking" in every label style
that shows words, and the badge's glyph pulses; the other tiers keep their label, since a lookup only
refines a read that exists. On Reddit, where every author on screen can be waiting at once, the glyph is held still and dimmed
instead, and only the badge under the pointer pulses: dozens of pulsing badges dropped a frame per
scroll step on the 1,500-comment fixture at 4x CPU throttling (docs/performance.md). Likely human needs confidence 0.5 or more and two worded observations
beyond the handle's shape that do not point towards automation (docs/scoring-spec.md, step 7); below that the badge is No read.

Label style is a setting with three values: Plain, Sus scale, Icon only. It changes the words only.
Colors, glyphs, thresholds and hover-card content are the same in every style. The accessible name of a
badge is always the plain label.

The review rejected the research-driven neutral copy ("Many automation signals", "Some automation
signals", a badge on every author) as reading poorly. The user chose set A from six candidate sets, with
the Sus scale and icon-only sets kept as options because they are fun and small. The reasoning and
tradeoffs are in [decisions/ADR-0017](decisions/ADR-0017-badge-wording-and-label-styles.md).

## Surfaces

- **Badge.** 16px pill on X and Bluesky, 14px in a Reddit post credit bar, 12px in a Reddit comment meta
  row (glyph only by default at that density). States: filled, hollow (low confidence, and always for
  No read), dashed (paused), loading (while the account's Tier 2 lookup is queued or running: on Reddit
  from mount, since authors are looked up on sight, with a still, dimmed glyph except under the
  pointer; on X and Bluesky a pulsing glyph while a hover lookup runs).
- **Hover card.** 320px, anchored below the badge, flipped above when there is no room. A card that
  grows while open (its clauses opened, a lookup landed) keeps the side it opened on and is clamped
  inside the viewport, overlapping the badge if it must. Title repeats the badge label, handle in mono. Then two labelled
  blocks (ADR-0022):
  - **"Why it leans this way"**: the reasons in a sunken list. Each row is a marker, the observation
    and a source dot per tier at the end (on the page, page data, profile lookup). The marker is a
    strength bar, whose fill takes a third, two thirds or all of its track for a weak, moderate or
    strong reason and runs from red through amber and grey to green (ADR-0023), then an arrow (↑
    towards automated, ↓ towards ordinary). Under the list, one link-style button with a chevron,
    "What these mean" ("What this means" for one reason), shows every row's why clause on its own
    muted line under the observation and then reads "Hide explanations" ("Hide explanation"). Each
    opening of the card starts with the clauses hidden; no button is drawn when no reason has a
    clause.
  - **"Why this could be wrong"**: the caveat, then the confidence line when sources are missing
    (a source that delivered data counts even when a later source overwrote all of its fields). A
    Declared bot card heads its neutral declared line "What this means" instead.

  The source legend sits between the blocks the first time a card opens in a session, and the footer
  has "This looks wrong" and "Settings". Declared bot cards use the same blocks with their one declared
  reason, its arrow in the declared colour with no strength bar, no clause toggle (its clause,
  "self-declared", would repeat the block below), and the neutral declared line. Opens after 150ms, closes 200ms after the pointer leaves badge and
  card, also opens on keyboard focus and closes on Escape. A No read card replaces the reasons with one
  sentence on why there is nothing to read (lookups off, a login wall, nothing returned, not looked up
  yet, or "Loading this account's public profile." while it runs) and drops the confidence line, the
  caveat and "This looks wrong".
- **Popup.** Status line with policy age, a notice when the policy carries one, per-platform toggles,
  conservative mode, privacy sentence, link to settings.
- **Options.** Platforms, lookups (conservative mode), badges (label style, show Likely human, labels in
  Reddit comments), feedback (export, clear), policy (version, verified, fetched, check now), reset.
- **Onboarding.** Three panels: what the badge means (set A shown live), what data is used and what
  never leaves the browser, how to turn it down.

## Copy rules

- Observations are sentence case, carry a number or a date, no trailing period, at most 60 characters.
- A Likely human observation may be a plain fact with no number ("Custom avatar", "Verified email"); a
  pattern that is absent gets no line, never a negated one.
- Every reason carries a why clause: written as a lowercase fragment with no trailing period, at most
  about eight words, aiming for one 12px line on the 320px card. The card shows it as a sentence (first
  letter capitalised, a full stop added) on its own line once the reader opens the clauses. Clauses
  condense the mechanism in scoring-spec.md "Why each feature is a signal" and change when it changes;
  the table of clauses is in scoring-spec.md "Reason templates and caveats".
- The caveat names the innocent explanation for the dominant signal; on a Likely human card it names
  how an automated account could show the same ordinary evidence. It sits under its own label, so it
  reads as the case against the read, not as part of the reasoning. The label carries the
  disclaimer, so no generic closer follows; only a factual one does (sources missing, a long-lived
  account). Counter-cases stand alone, without a "nothing here is proof" tail.
- Second person for settings, first person plural for the product's own promises. No exclamation marks,
  no emoji.
- The word "bot" appears only in the fixed badge labels and card titles, never in a reason line.
- Sus-scale labels never change the card body.

## Accessibility

- Every text and outline pair clears 4.5:1 (text) or 3:1 (outlines) on white, X dim and lights-out, new
  and old Reddit, and Bluesky light and dim, in both themes. Verified with a script during the design
  pass; the values are the tokens' usage notes.
- Tiers differ by lightness and glyph, never hue alone. Likely bot (red) and Likely human (green) also
  differ in glyph and are never the only two states on screen.
- The badge is a button with an accessible name; the card is a dialog with the handle in its label.
- A reason's direction is carried by the arrow's shape, with the direction's colour token (Likely
  bot's for automated, Likely human's for ordinary, Declared bot's on a declared card) as
  reinforcement only. Its strength is carried by the fill's height, with the colour as reinforcement
  only. The bar and arrow are one image with one accessible name and the same title, strength first:
  "Strong, points towards automated", "Weak, points towards ordinary"; a declared reason, which has
  no strength, is "Points towards automated".
- The clause toggle is a real button in the tab order, with `aria-expanded` and `aria-controls`
  naming the reasons list. While the pointer is inside the card, a close request from the badge
  (its blur when the click lands in the card) is ignored, so a click anywhere in the card, on a
  control or on text, never closes it. Keyboard focus leaving the card closes it, and so does a
  touch or pen press elsewhere on the page, since those pointers fire no mouseleave.
- Reduced motion removes the rise on open and the loading pulse.

## Name

"Botdar" stays for the MVP. A branding pass with the six candidates on the Names artboard happens before
the first public release, not now.
