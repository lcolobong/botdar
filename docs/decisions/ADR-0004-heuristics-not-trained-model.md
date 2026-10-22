# ADR-0004: Hand-tuned log-odds heuristics rather than a trained model

Status: Accepted
Date: 2026-10-22

## Context

The heuristics research (docs/research/heuristics.md) found that metadata-only bot classifiers reach
0.95 to 0.99 AUC inside the dataset they were trained on but 0.6 to 0.75 on unseen populations.
Hays et al. (WWW 2023) showed a depth-1 decision tree matches state of the art on TwiBot-20 and that
leave-one-dataset-out balanced accuracy is 0.52 to 0.84, near chance in the worst cases. The high
benchmark numbers reflect how datasets were collected, not a stable bot/human difference.

No usable pretrained lightweight model exists: BotArtist is CC BY-NC-SA with the model not released,
Botometer X is archival only, and the Twitter v1.1-era training fields (`favourites_count`,
`listed_count`, `default_profile`) are mostly not visible on today's X web client. Nothing exists at
all for Reddit or Bluesky.

## Decision

Score with hand-tuned weighted log-odds heuristics per platform. Each feature maps its value through
bins to a capped log-odds contribution; positive contributions within an independence group are
capped as a group; the sum plus a prior passes through a logistic function and is bucketed per
ADR-0003. Directions and thresholds come only from the literature (posts per day of account age,
following count and follower ratio, account age, handle shape, default avatar and empty bio, reply
share) and from platform-specific practitioner findings.

Weights live in `src/core/scoring/weights.default.json` and can be lowered or tightened by the
remote policy (ADR-0007). Feedback is collected locally from day one so a small logistic regression or
shallow tree ensemble can be fit and calibrated later on Botdar's own data.

## Consequences

- No training pipeline, no model file, no remote-code concerns at the store.
- The first weights are educated guesses; a calibration pass on about 200 live accounts is required
  before publishing, and `docs/scoring-spec.md` records every bin and its rationale.
- Expect low recall and reasonable precision; see ADR-0003 for why that is acceptable.

## Alternatives considered

- **Ship a model trained on TwiBot or Cresci data.** Rejected: cross-dataset results say it would not
  beat rules on 2026 populations, and the training fields are not available client-side.
- **Train on scraped data first.** Rejected: no labels, ToS exposure, and it delays shipping.
