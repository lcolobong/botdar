# ADR-0022: Reasons say why; the caveat is labelled

Status: Accepted · Date: 2026-10-25 · Amends ADR-0017 and ADR-0020

## Context

The hover card listed two to four observations ("Joined 3 weeks ago", "~140 posts/day since joining")
with source dots, then a caveat sentence ("High-volume human posters, news desks and brand accounts show
the same pattern. This is a pattern read, not a verdict. Humans trip these signals every day."). The
reasoning behind each observation lived only in docs/scoring-spec.md "Why each feature is a signal".

The user's feedback on 2026-10-25: "Some feedback on the copy, we list all the signals but we don't
explain why they indicate one conclusion or another. The caveat makes it look like it's the reasoning
and not an excuse for why the labeling might be wrong. We need to be clearer on that." Then: "let's
change up the copy ... The goal is to be concise and clear and easy for a user to digest at a glance."

A Likely human card (ADR-0020) had no counter-case at all: it closed with "These signals look like an
ordinary account; nothing here is proof." whatever its evidence.

The alternatives for the card (A to D) are on the "Hover card explorations" page of the project canvas,
https://claude.ai/artifact/AM2UKsqdyJU7qy919pPFAe; this decision is the structure agreed from them.

## Decision

- **Every reason gets a direction and a why clause.** An arrow before the observation points up
  towards automated or down towards ordinary; a short clause after it, muted and after a middle dot,
  says why the observation points that way ("Joined 3 weeks ago · new accounts often replace banned
  ones"). A positive contribution points towards automated, a negative one towards ordinary, and a zero
  contribution towards ordinary unless the feature has no ordinary reading (the country mismatch held
  at weight 0). The Likely human rule (ADR-0020) counts an item as ordinary evidence by the same test,
  so the country mismatch no longer vouches for an account, and the card lists an observation that
  two features word the same way once. The arrow's shape carries the direction; its colour comes from
  one token per direction (Likely bot's for automated, Likely human's for ordinary, Declared bot's on
  a Declared bot card, where the reason is a disclosure) and only reinforces it. The arrow is an
  image with an accessible name ("Points towards automated", "Points towards ordinary").
- **Why clauses track the scoring rationale.** Each clause condenses the mechanism for its feature in
  docs/scoring-spec.md "Why each feature is a signal", in at most about eight words, and the clause
  table in that spec's "Reason templates and caveats" is the reference. They follow the wording rules:
  they describe the pattern, never the person, and never contain "bot"; `allFixedStrings()` includes
  them so the wording-rule test covers them.
- **Two labelled blocks.** "Why it leans this way" sits above the reasons and "Why this could be wrong"
  above the caveat, so the caveat reads as the case against the read rather than as its reasoning.
  The confidence line moves under the caveat. Likely bot, Unsure and Likely human cards share the
  structure. A Declared bot card keeps its one declared reason, with the clause "self-declared", and
  its neutral declared line under "What this means" instead, since that line explains
  the label rather than arguing against it. No read cards are unchanged.
- **The caveat keeps the group counter-case and only factual closers.** Likely bot and Unsure keep
  the sentence for the dominant group, followed by the existing closer for a long-lived account or
  for missing sources when one applies. The generic closers "This is a pattern read, not a verdict."
  and "Humans trip these signals every day." are dropped: the "Why this could be wrong" label and the
  group sentence already carry the disclaimer.
- **Likely human cards get a real counter-case**, chosen by the group of the strongest worded evidence
  that points towards ordinary: age, "An aged account can be bought and repurposed."; graph,
  "Followers can be bought."; profile, "A persona account fills its profile in too."; any other group,
  "These signals look like an ordinary account." The old tail "; nothing here is proof" is cut: the
  user found it awkward, and the counter-case under its label already says the read can be wrong.
- **The reason model carries it.** A verdict's reasons are records (`VerdictReason`: text, why,
  direction, signed contribution, source tier) rather than strings, so every wire passes them to the
  card unchanged. The declared reason takes the tier that saw the declaration.

## Consequences

- Cards are longer: a reason with its clause usually takes two lines, and each block adds a label.
  The smoke fixture's four-reason Likely bot card on X grows from about 385px to about 500px tall.
- A reason must wrap to two lines at most at the default font on the 320px card. The clauses were
  tuned against the longest realistic observation for each feature (a 15-digit handle, a country name,
  seven-figure follower counts) in Chromium with the macOS system font, and the reasons box lost 4px of
  side padding to make room. Fonts wider than the system font on other platforms can still push the
  longest observations ("Username matches Reddit's auto-generated pattern · kept as suggested") to a
  third line; a new template or clause needs the same check.
- Why clauses must change when the scoring-spec rationale for their feature changes, and a new feature
  needs a clause before it can ship (whyClauses.test.ts checks every template has one).
- The feedback log still stores the observation text only; the direction and clause follow from it.
- **Planned follow-up: a strength scale.** Mocks are being drawn for colouring each reason row from red
  through yellow to green by how strong a flag it is. The reason already carries its signed
  contribution and the marker takes its colour from a per-direction custom property, so the scale can
  replace those tokens (with Unsure's tokens for a middle bucket) without another model or markup
  change. It must keep the arrow's shape and accessible name, never colour alone.

## Alternatives considered

- **Keep the facts and expand the caveat.** That made the caveat read even more like the reasoning,
  which was the complaint.
- **Explain reasons in a tooltip or an expandable row.** Hidden on a card that is itself a hover
  surface, and nothing to digest at a glance.
- **A neutral third direction for zero-weight evidence.** More literal about the arithmetic, but most
  ordinary observations on a Likely human card ("Custom avatar", a karma split) weigh zero, so the
  card would show neutral markers on exactly the evidence it relies on, unlike the Likely human rule
  (ADR-0020), which counts them as not pointing towards automation.
