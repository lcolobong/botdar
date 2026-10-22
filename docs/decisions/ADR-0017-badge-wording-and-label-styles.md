# ADR-0017: Badge wording, quiet feed, and selectable label styles

Status: Accepted · Date: 2026-10-22 · Amends ADR-0003

## Context

ADR-0003 chose neutral tier copy ("Looks typical", "Some automation signals", "Many automation signals")
and a badge on every post author, following Botometer's guidance and the false-positive literature. In
the design review the user judged that copy hard to read and the always-present badge noisy, and asked
for wording that says what the product thinks, a stronger icon, and no badge on accounts that look fine.
Six candidate sets were drawn (plain verdict, probability words, risk meter, icon only, "Sus scale",
"NPC energy").

## Decision

- Default labels: **Likely bot**, **Unsure**, **Declared bot**, and an optional **Likely human** that is
  off by default. Accounts that look fine and accounts with too little data draw no badge.
- Label style is a user setting: Plain (default), Sus scale (Sus / Kinda sus / Honest self-report bot /
  Real af), Icon only. Styles change words only; colors, glyphs, thresholds and card content are fixed.
- Icons: a red-eyed bot head for Likely bot, an outlined bot head with a question mark for Unsure, a tag
  for Declared bot, a person for Likely human.
- The guardrails from ADR-0003 that survive: the top tier still requires two independent signals and
  confidence at or above 0.5; reasons stay factual observations with numbers; every card carries a
  "This can be wrong:" caveat; the word "bot" never appears in a reason line; declared accounts are never
  scored.

## Consequences

- The badge is now a plain-language claim about an account. The cost of a false positive on a real
  person is higher than with neutral copy, which is why the gating, the caveat and the feedback button
  stay, and why the risk register's defamation entry keeps its trigger.
- A quiet feed means users see the extension working less often; onboarding panel one explains that most
  authors get nothing.
- Internal tier names (typical, some, many, declared, unknown) are unchanged in code and in the scoring
  spec; only the rendered labels map differently, so the engine and policy file are unaffected.
- "Real af" expands to a swear word. Store screenshots and the default experience use the plain style.

## Alternatives considered

- Keep neutral copy (rejected by the user as unreadable).
- "Probably a bot" / "Possibly a bot" (softer, but longer and no clearer).
- "Bot risk: high / medium / low" (reads as a score, which ADR-0003 argued against).
- Labelling every fine-looking account "Human" (the signals cannot confirm a person; kept as an opt-in
  "Likely human" instead).
