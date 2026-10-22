# Roadmap

Date: 2026-10-22. Platform decisions are recorded in [decisions/ADR-0005](decisions/ADR-0005-platform-roadmap.md)
and the evidence is in [research/platforms.md](research/platforms.md) and
[research/feasibility.md](research/feasibility.md).

## v1 (MVP)

| Platform | Why now | Signal sources |
|---|---|---|
| X | Biggest felt bot problem among news readers; rich author objects already arrive in the page's own GraphQL responses | Tier 0 DOM, Tier 1 timeline interception, Tier 2 About-account query on hover |
| Reddit | Cheap: cake day and karma in the DOM, logged-in `about.json`; official API is closing so client-side is the only route | Tier 0 DOM, Tier 2 `about.json` |
| Bluesky | Cheapest and lowest-risk of all: public AppView with open CORS, join date and counts, native `bot` self-label, Terms of Service that invite third-party tools | Tier 0 DOM, Tier 1 XRPC interception, Tier 2 public `getProfiles` |

## v1.1

| Platform | Notes |
|---|---|
| YouTube comment authors | Commenters expose nothing in the DOM; one innertube `browse` per channel for join date and video count. Scam-comment bots impersonate the creator. Client-side only; the Data API bans derived metrics. |
| Hacker News | Firebase `user/<id>.json` has created date, karma and submissions, no rate limit, CORS allows the HN origin. Trivial adapter. |

Scoring in v1.1 adds the six local countermeasures recommended in
[adversarial-evasion.md](adversarial-evasion.md#5-cost-raising-framing): `thread.nearDuplicateReply`,
`thread.sharedRareDomain`, `x.gapRegularity`, `x.noSleepWindow` (with Bluesky twins), `x.agedRepurposed`
and `reddit.karmaSinceFirstActivity`, each gated on its calibration result.

## v1.2

| Platform | Notes |
|---|---|
| Mastodon | Open `/api/v1/accounts/lookup` on every server, `bot` flag, created date and counts. Needs an optional host permission per server the user adds. Server reputation is a usable signal. |

## Conditional

| Platform | Condition |
|---|---|
| Threads | Only after a legal review. Meta is the one platform with a record of suing an extension maker (BrandTotal) and of banning researchers (Ad Observatory). The official API cannot look up arbitrary accounts. |

## Deferred

| Platform | Reason |
|---|---|
| Facebook | Largest news audience (40% of US adults) and a severe slop problem, but obfuscated, fast-changing page structure and the Meta litigation record. |
| Instagram | Profile lookups return 429 even logged in; doc ids rotate every few weeks; Meta. |
| TikTok | No join date in the page, signed internal requests, no usable API. |
| Truth Social | Thin bot evidence; Cloudflare blocks logged-out access; Terms ban scripts. Revisit if evidence grows. |
| Telegram | Strong academic evidence of bot networks in channel comments, but the web client speaks MTProto and shows only name and avatar. No signals to score. |
| Nextdoor | Address-verified accounts; low bot problem; login-only. |

## Never

| Platform | Reason |
|---|---|
| LinkedIn | The User Agreement explicitly bans browser add-ons that overlay or insert elements, the page probes for thousands of extension ids, and LinkedIn sues scrapers. Not worth the exposure. |

## Dropped from consideration

WhatsApp Channels (only admins post), Discord (gated servers), Substack Notes (no evidence of a problem),
Gab (tiny audience).

## Non-platform work after MVP

- Safari Web Extension wrapper for iOS and macOS Safari.
- Optional cloud layer behind the existing seam: LLM content analysis, coordination detection across
  accounts, shared verdict cache. Requires a privacy policy update and a Limited Use disclosure.
- A tiny trained model per platform once local feedback and calibration data exist.
- A Bluesky labeler is a separate decision; see [decisions/ADR-0015](decisions/ADR-0015-bluesky-extension-not-labeler.md).
