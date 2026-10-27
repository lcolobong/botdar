# ADR-0023: A strength scale on every reason; why clauses wait behind one toggle

Status: Accepted · Date: 2026-10-26 · Amends ADR-0022

## Context

ADR-0022 gave every reason on the hover card an arrow towards automated or ordinary and a muted why
clause after a middle dot, under the label "Why it leans this way". It left a strength scale as a
planned follow-up, since every reason already carries its signed contribution.

Mocks for the scale and for the card's density are on the "Hover card explorations" page of the
project canvas, https://claude.ai/artifact/AM2UKsqdyJU7qy919pPFAe. The user chose mock B, a strength
bar beside each reason's arrow, and then said of the card: "it's a bit dense and I'd like us to think
about ways in which we can hide the details/reasoning until a user explicitly wants to see the nuance
and reasoning, as a progressive disclosure type of thing". From the disclosure variants drawn next
(P1, P2a to P2d, P3) the user picked P2d, one toggle for all clauses (boards "P2d · One toggle for
all, closed/open" and "P2d · One signal, closed/open").

## Decision

- **Every weighed reason gets a strength bucket.** The size of its signed contribution puts it in
  one of three buckets: strong from the engine's own strong threshold upwards (0.6, the threshold
  that the independence rule of ADR-0003 counts), moderate from 0.3, weak below. 0.3 is the bar a
  reason clears to be listed on its own merit (`REASON_MIN_ABSOLUTE_CONTRIBUTION` in
  `src/core/scoring/reasons.ts`), so a weak reason is exactly one listed only to pad the card to two.
  `reasonStrength()` in `src/core/scoring/strength.ts` owns the buckets and imports both
  thresholds, so the card and the scoring can never disagree about them. The declared reason
  carries no contribution, so it is a disclosure and gets no bucket.
- **A bar beside the arrow draws the bucket.** A 4px track sits in the marker column before the
  arrow. Its fill takes a third, two thirds or all of the track for weak, moderate and strong. The
  fill's colour runs from red through amber and grey to green:

  | Bucket | Towards automated | Towards ordinary |
  |---|---|---|
  | strong | `--tier-many-line` (Likely bot's red) | `--tier-human-line` (Likely human's green) |
  | moderate | `--tier-some-line` (Unsure's amber) | `--tier-human-soft-line` (a lighter green, new) |
  | weak | `--tier-unknown-line` (neutral grey) | `--tier-unknown-line` (neutral grey) |

  The arrow keeps its per-direction colour from ADR-0022, and a declared card keeps its neutral
  declared arrow with no bar.
- **Colour is never the only cue.** The fill's height encodes the bucket on its own, the arrow's
  shape still carries the direction, and the marker has one accessible name that says both:
  "Strong, points towards automated", "Weak, points towards ordinary". A reason without a bucket
  keeps "Points towards automated".
- **Why clauses wait behind one toggle (P2d).** By default a row shows its marker, the observation
  and its source dot. One link-style button sits under the reasons list, with a chevron: "What these
  mean" for more than one reason, "What this means" for a single one. Pressing it shows every row's
  clause on its own line under the observation, as a muted sentence with a full stop, and the button
  then reads "Hide explanations" or "Hide explanation". It is a real button in the tab order with
  `aria-expanded` and `aria-controls` on the reasons list. The open state belongs to the card: it
  is not stored, and each opening of the card starts closed. A row without a clause shows no why
  line, and a card where no reason has a clause shows no button.
- **A Declared bot card has no toggle.** Its one reason's clause is "self-declared", and the card
  already explains the label under "What this means" (ADR-0022). A toggle reading "What this means"
  above that block would say the same thing twice. This holds by construction rather than by tier:
  the toggle explains only weighed evidence (a reason with a contribution and a clause), and the
  declared reason is a disclosure with no contribution. Its clause stays in the data.
- **Everything else in ADR-0022 stays.** The "Why it leans this way" and "Why this could be wrong" (or
  "What this means") labels, the legend, the confidence note and the footer are unchanged; the mocks
  left the labels out only for brevity. The four toggle labels and the marker names join the
  wording rules through `cardFixedStrings()` in `src/ui/cardCopy.ts`, checked by a UI test
  (`tests/unit/ui/cardCopy.test.ts`) so core tests never import the UI.

## Consequences

- With the clauses closed, each reason is one line again in most cases, so a card is close to its
  height before ADR-0022 (about 385px). The smoke fixture's four-reason Likely bot card on X goes
  from about 455px tall to about 405px, toggle included, and opening the clauses adds about 70px.
- A card that grows while open (the toggle, or a lookup that lands) keeps the side chosen when it
  opened and is clamped inside the viewport, overlapping the badge rather than running off screen.
  It never flips on growth: that would pull it away from a pointer on its way from the badge, or
  out from under one that just clicked in it, and make every slow lookup jump the card.
- A click anywhere in the card keeps it open. The click blurs a focused badge, whose blur asks
  the card to close; the controller ignores that while the pointer is inside the card. A card
  clamped over its badge waits 600ms rather than 200ms before closing on the badge's mouseleave,
  so the card's own mouseenter can cancel it.
  Touch and pen presses fire no mouseleave, so a press elsewhere on the page closes the card, and
  keyboard focus leaving the card closes it like the pointer leaving.
- A why clause still has to exist for every template and still follows ADR-0022's wording rules;
  only its default visibility changed. Clauses are written as lowercase fragments and the row turns
  them into sentences, so whyClauses.ts and the scoring-spec table keep one form.
- The two-line limit on a reason with its clause no longer applies, since the clause has its own
  line. A clause should still aim for one 12px line on the 320px card.
- A reader who wants the reasoning has to ask for it once per card. That is the point of the change,
  and the bar keeps the strength readable at a glance without it.

## Alternatives considered

All of these are boards on the same canvas page. The user chose P2d over them.

- **P1, verdict first.** The card opens on the label, one plain sentence, a strip of strength bars
  and the counter-case, and "Show the reasons" expands the reasons in place. It hides the
  observations, which are the card's evidence, behind a click, and needs a summary sentence
  written for every combination of reasons.
- **P2a, a "?" button at the end of each row.** Each row opens its own clause. It puts a control on
  every row of an already dense card, and a reader who wants the reasoning opens them one by one.
- **P2b, a dotted underline on each observation.** The dictionary-term convention: clicking the
  observation opens its clause. Nothing but the underline says the row opens.
- **P2c, a chevron on hover.** Rows are plain until hovered, then show a chevron. Touch screens
  have no hover, so nothing hints that rows open.
- **P3, two stages.** Hovering shows a one-line strip with the strength bars and the facts; the full
  card opens on click or a long hover and stays until dismissed. It adds a second surface and a
  second way of opening for the same content.
- **Showing clauses always (ADR-0022 as it stood).** The density the user asked to cut.
- **The mocks' bar alone, at a full row height for every bucket.** The boards draw the bar without
  the arrow and grade it by colour only. Keeping the arrow and grading the fill's height keeps the
  rule that colour is never the only cue (design.md "Accessibility").
