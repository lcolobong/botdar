# Roadmap

Date: 2026-10-22. Platform decisions are recorded in [decisions/ADR-0005](decisions/ADR-0005-platform-roadmap.md)
and the evidence is in [research/platforms.md](research/platforms.md) and
[research/feasibility.md](research/feasibility.md).

## v1 (MVP)

| Platform | Why now | Signal sources |
|---|---|---|
| X | Biggest felt bot problem among news readers; rich author objects already arrive in the page's own GraphQL responses | Tier 0 DOM, Tier 1 timeline interception, Tier 2 About-account query on hover |
| Reddit | Cheap: cake day and karma in the DOM, logged-in `about.json`; official API is closing so client-side is the only route | Tier 0 DOM, Tier 2 `about.json` on sight and `overview.json` on hover |
| Bluesky | Cheapest and lowest-risk of all: public AppView with open CORS, join date and counts, native `bot` self-label, Terms of Service that invite third-party tools | Tier 0 DOM, Tier 1 XRPC interception, Tier 2 public `getProfiles` and `getAuthorFeed` |
| Hacker News | Pulled forward from v1.1 on 2026-10-26 ([ADR-0026](decisions/ADR-0026-hacker-news-adapter.md)): Firebase `user/<id>.json` has created date, karma, submissions and the about text, no login, no documented rate limit, and CORS admits the HN origin, so the adapter was trivial and needed one new host | Tier 0 DOM (username), Tier 2 Firebase `user/<id>.json` on sight |

## v1.1

| Platform | Notes |
|---|---|
| YouTube comment authors | Commenters expose nothing in the DOM; one innertube `browse` per channel for join date and video count. Scam-comment bots impersonate the creator. Client-side only; the Data API bans derived metrics. |

Scoring in v1.1 adds the remaining local countermeasures recommended in
[adversarial-evasion.md](adversarial-evasion.md#5-cost-raising-framing): `thread.sharedRareDomain`
and `x.agedRepurposed`, each gated on its calibration result.
`reddit.karmaSinceFirstActivity` moved into v1 on 2026-10-27
([decisions/ADR-0028](decisions/ADR-0028-reddit-karma-since-first-activity.md)). The timing pair from the same set, `x.gapRegularity` and `x.noSleepWindow` with their Bluesky twins, moved
into v1 on 2026-10-26 ([decisions/ADR-0024](decisions/ADR-0024-posting-cadence-features.md));
`reddit.gapRegularity` waits for its measurement. `thread.nearDuplicateReply` moved into v1 on
2026-10-27 on all four platforms ([decisions/ADR-0027](decisions/ADR-0027-near-duplicate-reply.md));
its calibration and recordings of X, Reddit and Bluesky thread pages are still owed.

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
- Persisted on-device Tier 2 cache (seven days, salted-hash keys) in v1.1; see
  [decisions/ADR-0018](decisions/ADR-0018-no-shared-cache-yet.md).
- Optional cloud layer behind the existing seam: LLM content analysis, coordination detection across
  accounts, shared signal cache. Requires a privacy policy update and a Limited Use disclosure; the
  shared cache is deferred with conditions in ADR-0018 and explored in
  [shared-cache-exploration.md](shared-cache-exploration.md).
- A tiny trained model per platform once local feedback and calibration data exist.
- A Bluesky labeler is a separate decision; see [decisions/ADR-0015](decisions/ADR-0015-bluesky-extension-not-labeler.md).
