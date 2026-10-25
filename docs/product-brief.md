# Product brief: Botdar (working title)

Date: 2026-10-22 · Status: approved for MVP build · Owner: maintainer

## Problem

People who read news and discussion on X, Reddit and Bluesky cannot tell at a glance whether the account
behind a post is a person or an automated account. Reply sections are full of engagement-farm replies,
crypto spam and LLM-written "reply guys". Every tool that once badged accounts in the feed is dead or
frozen: Bot Sentinel stopped in 2022, BotSight is gone, Botometer X only holds archival scores for
accounts that existed before June 2023, and the live alternatives have fewer than 150 users each. The
one tool with adoption, Pangram, judges whether a *post's text* is AI-written, not whether the *account*
behaves like an automated one, and it has public false-positive embarrassments. See
[research/landscape.md](research/landscape.md).

## What we are building

A browser extension that adds a small badge next to the author of every post in the feed, on a
three-step scale, and a hover card that explains the badge in neutral, factual terms. Everything is
computed in the browser from signals the page already shows or already fetched for itself. Nothing about
the accounts you look at leaves your machine.

Badge labels (plain style, the default; see [design.md](design.md) for the Sus scale and icon-only styles):

| Internal tier | Label | Meaning | Shown |
|---|---|---|---|
| many | Likely bot | Several independent signals, confidence at or above 0.5 | yes |
| some | Unsure | One or two signals | yes |
| declared | Declared bot | The platform's own automated label is set | yes |
| typical | Likely human | Enough is visible and nothing stands out | yes; the "Show Likely human" setting turns it off |
| unknown | No read ("Checking" while a lookup runs) | Not enough data | yes |

The badge label is a plain claim; everything on the hover card is an observation with a number or a date in it, and every card says how it could be wrong. "Fake", "troll" and similar words never appear.

## Who it is for

- Primary: people who read news and politics on X, Reddit and Bluesky and want a quick sanity check on
  who they are reading or arguing with.
- Secondary: journalists, researchers and moderators who want reasons they can quote, not a black box.

## Goals

1. A badge on every post author in the X home timeline, X threads, Reddit feeds and comment threads, and
   Bluesky feeds and threads, with a hover card of two to four reasons.
2. Zero data egress. The only network request the extension makes on its own is a daily fetch of a
   signed policy file.
3. Honest about uncertainty. A hollow badge when data is thin. A "why this might be wrong" line on every
   card. A one-click "This looks wrong" feedback button.
4. Survivable. Any signal source can be switched off per platform within a day, without a store
   release, through a signed policy file. A user-facing conservative mode does the same locally.
5. Shippable on the Chrome Web Store under its Limited Use and Manifest V3 rules, and on Firefox AMO.

## Non-goals for v1

- No backend, no accounts, no shared verdict cache, no LLM content analysis. There is a clean seam for
  all of these later.
- No hiding, collapsing or filtering of posts. Users keep seeing everything.
- No percentage scores. Three tiers plus declared and unknown.
- No Instagram, TikTok, Facebook, Threads, Truth Social, Telegram or LinkedIn. See
  [roadmap.md](roadmap.md) for why and when.
- No mobile. iOS can only be reached later through a Safari Web Extension wrapper.

## Scope by release

| Release | Platforms | Notes |
|---|---|---|
| v1 (MVP) | X, Reddit, Bluesky | Chrome Web Store; Firefox from the same build |
| v1.1 | YouTube comment authors, Hacker News | YouTube needs one lookup per commenter |
| v1.2 | Mastodon | per-server optional host permission |
| later | Threads (after legal review), Safari wrapper, cloud layer | |

## Success measures

| Measure | Target for the first 90 days after launch |
|---|---|
| Weekly active users | 1,000 |
| "This looks wrong" feedback rate | under 5% of hover-card opens |
| Store rating | 4.5 or above |
| Data egress | zero requests other than the policy fetch, verified by the test plan |
| Time to flip a policy switch | under 1 hour from decision to users receiving it |

## Principal risks

Platform pressure from X, Terms-of-Service claims, false positives that harm real people, schema rotation
breaking parsers, store review, and signing-key loss. Each has a mitigation and a trigger in
[risk-register.md](risk-register.md).

## Competitive summary

| Tool | What it does | Why Botdar is different |
|---|---|---|
| Pangram AI Detection | Labels post text as AI-written | Botdar scores the account's behavior and explains why |
| X Bot Detector (two hobby extensions) | Badges on X, one ships a 2018-era model, one sends features to a third-party server | Local-only, explainable, policy-switchable, three platforms |
| TrueVoice / Redd-Eye (Reddit) | Trust dot or outline on Reddit | Same idea, tiny adoption; Botdar covers X and Bluesky too |
| Botometer X | Paste-a-handle archival scores | In-feed, live, current accounts |
| Bluesky labelers | Public labels anyone can subscribe to | Botdar keeps verdicts private to the viewer and gives reasons |

## Name

"Botdar" is the working title. Alternatives are proposed in the design review and the decision is recorded
in [design.md](design.md).

## References

- [research/landscape.md](research/landscape.md), [research/feasibility.md](research/feasibility.md),
  [research/heuristics.md](research/heuristics.md), [research/platforms.md](research/platforms.md),
  [research/shared-cache-costs-and-law.md](research/shared-cache-costs-and-law.md),
  [research/reddit-bot-prevalence.md](research/reddit-bot-prevalence.md)
- [architecture.md](architecture.md), [scoring-spec.md](scoring-spec.md), [decisions/](decisions/)
