# Design

Date: 2026-10-22, badge states amended 2026-10-25 (ADR-0020) · Status: approved after one review round · Design system:
https://claude.ai/artifact/2jacALGXFe96ubLp62qRAe · Mockups: https://claude.ai/artifact/VVUVZk5BnEqBJPE4VA6sDc

## Principles

1. Every account is visibly analysed. Each author near the viewport carries a badge: a read when there
   is one, "No read" when there is too little to go on, "Checking" while the profile is loading. A
   Likely human badge is earned by the data, not given by default (amended by
   [ADR-0020](decisions/ADR-0020-badge-on-every-account.md); the quiet feed of ADR-0017 is one setting
   away for Likely human).
2. Plain words on the badge, facts on the card. The badge says "Likely bot" or "Unsure"; the hover card
   lists two to four observations with numbers and dates, and always ends with a "This can be wrong:" line.
   A Likely human card lists what looks ordinary ("Account is 9 years old", "Custom avatar") and ends
   with "nothing here is proof"; a No read card says why there is nothing to read and claims nothing.
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
- **Hover card.** 320px, anchored below the badge, flipped above when there is no room. Title repeats the
  badge label, handle in mono, reasons in a sunken list with a source dot per tier (on the page, page
  data, profile lookup), a confidence line when sources are missing, the caveat, and a footer with
  "This looks wrong" and "Settings". Opens after 150ms, closes 200ms after the pointer leaves badge and
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
- The caveat names the innocent explanation for the dominant signal.
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
- Reduced motion removes the rise on open and the loading pulse.

## Name

"Botdar" stays for the MVP. A branding pass with the six candidates on the Names artboard happens before
the first public release, not now.
