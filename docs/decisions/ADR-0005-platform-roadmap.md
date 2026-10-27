# ADR-0005: Platform roadmap

Status: Accepted, amended by ADR-0026 (Hacker News moved from v1.1 into v1)
Date: 2026-10-22

## Context

Two research passes ranked platforms by news audience (Pew Oct 2026 fact sheet), bot-problem severity,
client-side signal access and legal posture (docs/research/feasibility.md, docs/research/platforms.md).
Findings that drove the ranking:

- X: timeline GraphQL responses carry full author objects; flag extensions have done this in-store
  through 2026. Reddit: cake day and karma in the DOM plus logged-in `about.json`; the official API is
  shutting down (March 2027) so client-side is the only route. Bluesky: public AppView with CORS `*`,
  `createdAt`, counts, and a native `bot` self-label; ToS has no anti-scraping clause.
- YouTube: commenters expose no age or counts; one innertube call per channel. Hacker News: open
  Firebase API with no rate limit. Mastodon: open account API with a `bot` flag, but 743K MAU and a host
  permission per server.
- Instagram returns 429 even when logged in; Threads is login-walled with an official API that resolves
  four Meta accounts; Facebook is obfuscated. Meta is the only platform with a record of suing
  extension makers (BrandTotal) and banning researchers (Ad Observatory).
- Truth Social Cloudflare-blocks logged-out access and its ToS bans scripts. Telegram's web client is
  MTProto with no JSON and no comment authors on public previews. TikTok has no join date and signed
  requests.
- LinkedIn's User Agreement (Nov 2025) explicitly bans browser plugins that scrape and any overlay that
  inserts elements; its page probes about 6,000 extension IDs; it sued Proxycurl and ProAPIs in 2025.

## Decision

| Phase | Platforms |
|---|---|
| v1 | X, Reddit, Bluesky |
| v1.1 | YouTube comment authors, Hacker News |
| v1.2 | Mastodon (optional per-server host permission, server-reputation signal) |
| Gated | Threads, only after a legal review of Meta exposure |
| Deferred | Facebook, Truth Social, Telegram, Instagram, TikTok, until access or risk changes |
| Never | LinkedIn |

## Consequences

- The largest news audiences (Facebook 40%, Instagram 23%, TikTok 20%) are not served at launch. The
  product's early value is on X, Reddit and Bluesky, where it is also safest.
- The `PlatformAdapter` interface must stay thin enough that adding Hacker News is a one-PR job.
- `docs/roadmap.md` carries the reason for each deferral so revisiting is cheap.

## Alternatives considered

- **X only.** Rejected: Reddit and Bluesky are cheap and Bluesky lowers the overall risk profile.
- **Include YouTube in v1.** Rejected: weak signals, one extra request per commenter, and a Data API
  policy that bans derived metrics; it adds weeks before first ship.
