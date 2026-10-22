# ADR-0015: Bluesky support ships in the extension, not as a labeler

Status: Accepted
Date: 2026-10-22

## Context

Bluesky is the one platform whose moderation architecture natively supports third-party badges:
labelers publish label records, users subscribe to up to 19 of them, and the official app renders
labels on posts and profiles. The platform research (docs/research/platforms.md) confirmed from the
app source (commit 2026-10-21) that a `bot` self-label renders a robot badge and that labeler labels
with `severity: inform` and `blurs: none` render as neutral chips. A labeler reaches mobile users, who
are most of Bluesky's roughly 10M monthly users.

A labeler, however, requires running an Ozone service that scores the whole network continuously from
the firehose, handles appeals, and publishes labels as **public records** with fixed text per label
value. That conflicts with three Botdar principles: local-only processing (ADR-0002), per-account
reasons in the hover card (ADR-0003), and never making a public claim about a named account.

## Decision

Bluesky is a v1 platform inside the extension. Tier 1 reads author objects from the web app's own
feed responses; Tier 2 calls the public AppView `getProfiles` in batches. The `bot` self-label maps to
the `declared` verdict. A labeler is not planned; if mobile reach becomes a goal, it gets its own ADR
weighing the public-record and defamation exposure.

## Consequences

- Bluesky coverage is desktop-web only, like every other platform.
- Zero server cost and no public claims.
- Botdar should still subscribe to and respect existing labelers' output where visible in the DOM,
  and may later consume community block-list membership as a signal.

## Alternatives considered

- **Labeler only.** Rejected: public labels with fixed text, Ozone operations cost, and reputational
  exposure.
- **Both.** Deferred: only worth revisiting if mobile reach matters more than the risks above.
