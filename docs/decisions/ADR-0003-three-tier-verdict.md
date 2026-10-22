# ADR-0003: Three-tier verdict with neutral wording, never a percentage

Status: Accepted
Date: 2026-10-22

## Context

Rauchfleisch and Kaiser (PLOS ONE 2020) measured Botometer at its usual threshold on real accounts and
found precision of 0.59: four in ten flagged accounts were human, and 7.4% of German politicians crossed
the threshold at least once in three months. The Botometer team's own guidance ("Botometer 101", 2022)
rescaled scores away from 0 to 1 "to discourage inaccurate probabilistic interpretations" and says that
calling people "bots" is a misuse of the tool. Bot Sentinel was sued for defamation. Pangram publicly
flagged posts from Pope Leo XIV's account as AI-written.

Botdar has no labeled data, so any number it shows is uncalibrated. A percentage would read as a
measured probability it is not.

## Decision

The verdict is one of five states: `typical` ("Looks typical"), `some` ("Some automation signals"),
`many` ("Many automation signals"), `declared` (the platform's own automated label is present) and
`unknown` (no usable signals). No percentage is shown to the user.

Wording describes signals, never the person: "account shows patterns common in automated accounts",
never "this is a bot" or "fake". The hover card always lists two to four neutral factual reasons
("Joined 3 weeks ago · ~140 posts/day · following 4,900, followers 12") and a "why this might be
wrong" caveat keyed to the dominant signal group.

The `many` tier requires the score threshold **and** at least two evidence items from distinct
independence groups (age, activity, graph, handle, profile, verification, content, geo) **and**
confidence of at least 0.5. Low confidence (below 0.4) caps the tier at `some` and renders the badge
hollow.

## Consequences

- Recall for the top tier will be low. Cresci et al. 2015 showed rule lists give high precision and
  low recall; most automated accounts will read as "some" or "unclear". This is the intended trade.
- Copy must be reviewed against this ADR whenever a reason template or caveat is added.
- The internal log-odds score still exists for calibration and tests, but never reaches the UI.

## Alternatives considered

- **0 to 100 score.** Rejected: implies a calibration that does not exist and invites "this account
  is 87% bot" screenshots.
- **Binary bot / not bot.** Rejected: maximizes the false-positive harm this ADR exists to avoid.
