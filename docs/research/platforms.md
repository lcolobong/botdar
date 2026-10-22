# Other news-distribution platforms: audience, bot problem, access, and ranking

Date researched: 2026-10-22

## Summary and verdict

- **Bluesky** is the best platform of any researched for a client-side extension: a public read API with CORS `*` and no auth, `createdAt` and counts on every profile, a native `bot` self-label (Mar 2026), and a Terms of Service with no anti-scraping clause that explicitly invites third-party labelers. Small US news reach (1%), but the lowest legal risk.
- **Hacker News** is almost free to add (open Firebase API, no rate limit, green names for new accounts). **Mastodon** has open per-server APIs with a `bot` flag but a small audience (743K MAU).
- **Threads** (400M+ MAU, real reply spam) and **Facebook** (40% US news reach) carry Meta's litigation risk (BrandTotal precedent) and fragile, login-walled data. **Truth Social** blocks logged-out reads and bans scripts. **Telegram** has the strongest academic bot evidence but its web client exposes almost no account signals.
- **LinkedIn**: do not build. Its terms explicitly ban overlays and plugins, its page probes for ~6,000 extension IDs, and it sues scrapers.
- Suggested phasing: Bluesky and Hacker News next, then Mastodon, then Threads only after legal review; defer Facebook, Truth Social, Telegram, Instagram/TikTok, Nextdoor.
- For Bluesky, build the extension first. A labeler is a separate later decision: it reaches mobile but costs an Ozone server, public labels with no per-account reasons, and defamation exposure.

**Method.** Verified means fetched or tested on 2026-10-22. Public APIs were called with curl, and Bluesky's app source code was read (a commit dated 2026-10-21). Items marked secondary come from blogs or trade press. Items marked inference are the researcher's own reasoning.

**Candidate changes.**

- **Added:** Instagram (23% of US adults get news there) and TikTok (20%). Both are bigger news sources than X, but were only researched at a summary level. Rumble was added briefly.
- **Dropped:**
  - WhatsApp Channels: only the channel admin posts, so there are no third-party authors to badge.
  - Discord: gated servers and a small news role.
  - Substack Notes: no Pew data and no bot evidence found.
  - Gab: tiny audience. Its API does return `created_at`, counts and an `is_spam` field without login (tested), but that doesn't make up for the size.

## Audience as a news source

**Pew Social Media and News Fact Sheet**, published Oct 19, 2026. Survey of 5,166 US adults, Aug 24–30, 2026 ([Pew](https://www.pewresearch.org/journalism/fact-sheet/social-media-and-news-fact-sheet/)).

| Platform | US adults who regularly get news there (2026) | Share of the platform's own users (2026) | 2025 value ([Pew, Sep 25 2025](https://www.pewresearch.org/newsletter/the-briefing/platforms-americans-use-to-get-news-including-social-media-and-podcasts.md)) | Global monthly users |
|---|---|---|---|---|
| Facebook | 40% | 57% | 38% | not checked |
| YouTube | 34% | 41% | 35% | – |
| Instagram | 23% | 46% | 20% | – |
| TikTok | 20% | 53% | 20% | – |
| X | 10% | 57% | 12% | – |
| Reddit | 9% | 35% | 9% | – |
| Nextdoor | 8% | 45% | 6% | – |
| LinkedIn | 6% | 20% | – | – |
| WhatsApp | 5% | 16% | 5% | – |
| Rumble | 2% | 53% | 2% | – |
| Truth Social | 2% | 55% | 2% | no reliable figure found |
| Bluesky | 1% | 39% | 2% | ~10.4M mobile monthly users in Jun 2026 (Similarweb, secondary, [TechCrunch via Slashdot](https://tech.slashdot.org/story/26/08/16/0326249/)); 41.41M registered at end of 2025 ([Bluesky 2025 transparency report](https://bsky.social/about/blog/01-29-2026-transparency-report-overview)) |
| Threads | not in the 2026 sheet | – | 3% | 400M+ (Aug 2025, [TechCrunch](https://techcrunch.com/2025/08/12/threads-now-has-more-than-400-million-monthly-active-users)). The 500M figure for June 2026 appears only on aggregator sites (unverified) |
| Telegram | not measured by Pew | – | – | "significantly over 1 billion" (Durov, Mar 2025, [TASS](https://tass.com/economy/1930999/amp)) |
| Mastodon | not measured by Pew | – | – | 743,195 monthly active users across 7,353 servers on 2026-10-21 ([api.joinmastodon.org/statistics](https://api.joinmastodon.org/statistics), tested). mastodon.social alone: 270,032 (`/api/v2/instance`, tested) |
| Hacker News, Discord, Substack, Gab | not measured by Pew | – | – | not verified |

## Bot and automation problem

- **Facebook and Instagram.** Meta removed about 10M profiles impersonating large creators and acted on about 500K spam or inauthentic accounts in H1 2025 ([CNBC via NBC](https://www.nbcchicago.com/news/business/money-report/meta-removes-10-million-facebook-profiles-in-effort-to-combat-spam/3788949/)). Users clearly feel the problem (AI-slop pages, comment spam).
- **Threads.** Mosseri admitted an engagement-bait problem in Oct 2024 ([MobileSyrup](https://mobilesyrup.com/2024/10/07/threads-fixing-influx-engagement-bait/)). Reply spam pushing betting and crypto is anecdotal (secondary). No 2025–26 measurement was found.
- **Bluesky.** The 2025 transparency report (Jan 29, 2026) gives:
  - 2.08M accounts taken down (+104% year over year)
  - 9.97M user reports, 43.73% of them "misleading", which is mostly spam
  - 3,619 accounts removed for influence operations, mostly Russia-linked

  Source: [Bluesky](https://bsky.social/about/blog/01-29-2026-transparency-report-overview). Late-2024 reporting covered AI reply bots and impersonators: 44% of the top 100 most-followed named people had at least one duplicate account ([AP via ABC](https://abcnews.go.com/Technology/wireStory/bluesky-finds-growth-growing-pains-bots-117027810)). It is a felt problem; users spread block lists by hand.
- **Telegram.** The DFRLab/OpenMinds report (Jul 16, 2025) found 3,634 automated accounts posting pro-Russian comments in channel comment sections between Jan 2024 and Apr 2025 ([DFRLab](https://dfrlab.org/2025/07/16/report-russian-bot-networks-occupied-ukraine/)). Secondary coverage says the average bot posted 84 comments per day ([Euromaidan Press](https://euromaidanpress.com/2025/07/18/digital-occupation-russia-deploys-ai-army-of-bots-on-telegram-for-promoting-kremlins-propaganda-narratives/)). This is the strongest academic evidence for any candidate.
- **LinkedIn.** 113.7M fake accounts stopped in H2 2025, 88.9M of them at registration (secondary, [drweb.de](https://www.drweb.de/wie-viele-linkedin-profile-fake/); not confirmed on LinkedIn's [community report](https://about.linkedin.com/transparency/community-report)).
- **Truth Social.** Graphika and the Stanford Internet Observatory tied Russian personas to the platform during the 2022 midterms ([The Record](https://therecord.media/russian-trolls-found-manipulating-audiences-on-trumps-truth-social-new-research-finds/)). No measured prevalence for 2024–26 was found, so the evidence is thin.
- **Mastodon.** Spam waves in Feb 2024 hit small servers with open sign-ups ([TechCrunch](https://techcrunch.com/2024/02/20/spam-attack-on-twitter-x-rival-mastodon-highlights-fediverse-vulnerabilities/embed/)). The problem comes in bursts and is moderated per server. Low in day-to-day use.
- **Hacker News.** Complaints about AI comments from new ("green") accounts in 2025–26 are anecdotal (secondary, [ecosistemastartup](https://ecosistemastartup.com/por-que-hay-tantos-comentarios-spam-de-ia-en-foros-tech/)). dang's stated policy since 2020 is no bots.

## Signals a client-side extension can access

### Public APIs, tested 2026-10-22

- **Bluesky** `public.api.bsky.app/xrpc/app.bsky.actor.getProfile`
  - Returns HTTP 200 with `access-control-allow-origin: *` and `cache-control: public, max-age=30`. There were **no rate-limit headers**.
  - Fields: `did, handle, displayName, avatar, description, createdAt, followersCount, followsCount, postsCount, labels, verification, associated`.
  - `getProfiles` takes several actors per call; 3 were tested (the lexicon cap of 25 is not verified).
  - Post authors in feeds already carry `createdAt, labels, verification, associated`, but no follower or post counts.
  - Rate limits: the official docs give no unauthenticated read limit ([docs](https://docs.bsky.app/docs/advanced-guides/rate-limits)). "3,000 per 5 min per IP" is a third-party claim ([adaptlypost](https://adaptlypost.com/blog/bluesky-api-rate-limit)), unverified.
- **Mastodon** `/api/v1/accounts/lookup?acct=` (and `/api/v1/accounts/:id`)
  - Returns HTTP 200 with `access-control-allow-origin: *`.
  - mastodon.social sends `x-ratelimit-limit: 300` with resets on a 5-minute window. That is per IP, unauthenticated, measured on that one server.
  - Fields include `bot, created_at, followers_count, following_count, statuses_count, last_status_at, group, locked, discoverable, indexable, fields, note`.
  - Inference from the Mastodon API design: status entities embed the full account object, so intercepting the web app's own timeline responses gives all of these with no extra requests.
- **Truth Social** `/api/v1/accounts/lookup` from curl: **403 from Cloudflare.** One secondary source says logged-out viewing has been limited to prominent accounts since Aug 27, 2025 ([ScrapeCreators](https://scrapecreators.com/truthsocial-api)). Inference: the web app is Mastodon-derived, so its own in-session responses probably carry Mastodon-style account objects. Not verified in a browser.
- **Hacker News**
  - Firebase `user/<id>.json` returns `id, created, karma, about, submitted`.
  - Its CORS header reflects the `news.ycombinator.com` origin only, so the call works from a content script on that origin.
  - Official docs say "There is currently no rate limit" ([GitHub](https://github.com/HackerNews/API)).
  - Algolia `/api/v1/users/<id>` returns only `username, karma, about`. Its rate limit is not verified.
  - In the feed, HN renders usernames in green for new accounts.
- **Telegram** `t.me/s/<channel>` returns 200 HTML with subscriber count, per-post view counts and the channel author. It has **no comment authors.** Inference: web.telegram.org speaks Telegram's encrypted MTProto protocol over WebSocket, so there is no JSON to intercept; you would have to read the page itself, which shows only name and avatar.
- **Threads**: logged-out curl of `threads.com/@zuck` returned a login wall with no profile JSON. In-session GraphQL and embedded data are not verified.
- **Facebook and LinkedIn**: not tested. Inference: both use obfuscated GraphQL endpoints that change often, which makes interception fragile.
- **Facebook Pages**: the "Page transparency" panel (creation date, name changes, admin countries) is a strong signal. The panel's existence is from the researcher's own knowledge and was not re-verified.

### Visible signals in the web UIs

Bluesky, Mastodon and Truth Social profiles show the counts. Bluesky and Mastodon also show join dates. Bluesky shows a robot badge for self-labeled bots, and Mastodon shows an "Automated" badge.

## Official API status (2026)

- **Threads Profile Discovery** (`GET /profile_lookup?username=`)
  - Needs both `threads_profile_discovery` and `threads_basic`, plus a user access token.
  - Only works for public profiles with at least 100 followers.
  - Capped at 1,000 requests per user per rolling 24 hours.
  - **With standard access only @meta, @threads, @instagram and @facebook can be looked up** ([Meta docs](https://developers.facebook.com/documentation/threads/threads-profiles)).
  - Returns no join date.
  - Not usable for an indie extension without passing Meta's app review.
- **Bluesky/ATProto**: open. No key is needed for public reads (see above). Usable today.
- **Mastodon**: open per server, no token needed for account lookup. Usable.
- **Telegram Bot API** (10.3, Aug 24, 2026): `getChat` accepts `@username` only for supergroups and channels ([docs](https://core.telegram.org/bots/api#getchat)). It cannot look up arbitrary users by handle. The client library TDLib needs a logged-in user account. Not usable for lookups.
- **Facebook Graph and LinkedIn**: no lookup of arbitrary user profiles. This is the researcher's understanding and was not re-fetched.
- **Hacker News**: open (see above).

## Terms of service and enforcement posture

- **Meta.**
  - *Meta v. BrandTotal*: a **browser extension** (UpVoice). Meta won partial summary judgment on breach of contract and California's computer-access law in 2022, though the federal CFAA claim failed. The case settled in Oct 2022 with a permanent injunction ([TechCrunch](https://techcrunch.com/2022/10/03/meta-settles-lawsuit-for-significant-sum-against-businesses-scraping-facebook-and-instagram-data)).
  - *Meta v. Bright Data*: Meta **lost** on logged-out scraping (Jan 23, 2024) and dropped the case ([Goldman blog](https://blog.ericgoldman.org/archives/2024/02/facebook-drops-anti-scraping-lawsuit-against-bright-data-guest-blog-post.htm)).
  - Inference: an extension runs inside a logged-in session, so BrandTotal is the relevant precedent. The distinction that likely matters is that this extension only annotates locally and never collects data.
- **LinkedIn.** The User Agreement (effective Nov 3, 2025) explicitly bans "browser plugins and add-ons… to scrape" and bans "overlay or otherwise modify the Services… (such as by inserting elements)" ([LinkedIn](https://www.linkedin.com/legal/user-agreement)). **In-feed badges fall squarely under that wording.**
  - LinkedIn's page script probes for about 6,236 Chrome extension IDs by trying to load their bundled files (Apr 2026, [BleepingComputer](https://www.bleepingcomputer.com/news/security/linkedin-secretely-scans-for-6-000-plus-chrome-extensions-collects-data)).
  - It sued Proxycurl (Jan 2025; Proxycurl shut down Jul 2025) and ProAPIs (Oct 2025) ([Social Media Today](https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/), [The Record](https://therecord.media/linkedin-sues-data-scraping-company)).
  - Pitfall that applies to every site: extensions that expose bundled files to web pages (`web_accessible_resources`) can be fingerprinted this way. Avoid them, or use `use_dynamic_url`.
- **Truth Social.** The ToS bans "any automated system… scraper… or using or launching any unauthorized script or other software" and "data mining… tools" ([terms](https://help.truthsocial.com/legal/terms-of-service/), fetched). That wording is broad enough to cover an extension. No enforcement against extensions found.
- **Bluesky.** The ToS (updated Aug 14, 2025) has no anti-scraping clause and calls third-party apps the user's own risk ([ToS](https://bsky.social/about/support/tos)). Its "stackable moderation" post (Mar 12, 2024) explicitly invites independent labelers ([blog](https://bsky.social/about/blog/03-12-2024-stackable-moderation)).
- **Mastodon and Hacker News.** Open APIs; varies by server for Mastodon. Low risk.
- **Telegram.** No enforcement against extensions found. Not verified.

## Native bot labels and labeling mechanisms

- **Bluesky self-label `bot`** (confirmed in source).
  - Added in social-app PR #10008 on 2026-03-10.
  - The app shows a robot badge when a profile carries `labels[].val === 'bot'` with `src === profile.did` (`src/components/BotBadge.tsx`).
  - It is in the global self-label set ([docs source](https://raw.githubusercontent.com/bluesky-social/bsky-docs/main/docs/advanced-guides/moderation.md)).
  - It is a free, high-precision signal to consume.
- **Bluesky third-party labelers.**
  - Each label value is defined with `severity` (alert, inform or none), `blurs` (content, media or none) and a `defaultSetting`. `blurs=none` with `severity=inform` gives a neutral chip on posts and profiles.
  - Users subscribe to labelers themselves. The cap is `MAX_LABELERS = 20` including Bluesky's own, so 19 slots for users (`src/lib/constants.ts`; docs).
  - Labels attach through the `atproto-accept-labelers` header.
  - Label definitions are fixed text per value, so a labeler **cannot carry per-account reasons**.
  - Labels are **public records**.
- **Mastodon**: a self-set `bot` boolean, shown as an "Automated" badge.
- **Meta**: "AI info" labels on content, not on accounts (from the researcher's knowledge, not re-fetched). No account-level bot label.
- **Truth Social**: nothing found.

## Platform-specific heuristics

These are practitioner heuristics (inference or secondary), not validated thresholds.

- **Bluesky:**
  - `*.bsky.social` handle with a run of digits
  - `createdAt` bursts across accounts
  - `postsCount` near 0 with high `followsCount`
  - replies-only activity
  - duplicate display names (impersonation)
  - AI-generated avatars or matching bios (the German network)
  - the `bot` self-label
  - membership in community block lists
- **Mastodon:**
  - server reputation (open sign-ups, recently created server, found on the Oliphant or Garden Fence blocklists)
  - `created_at` against `statuses_count`
  - `last_status_at`
- **Hacker News:**
  - green (new) account
  - low karma relative to age
  - comment-only history from `submitted`
  - old dormant accounts suddenly posting in bursts
- **Threads:**
  - brand-new account with no posts replying in volume
  - betting or crypto link in bio
  - sign-up without Instagram became possible in May 2025 ([Open Terms Archive](https://opentermsarchive.org/en/memos/threads-expands-profile-creation-beyond-instagram-users/)), which weakens the "tied to an Instagram identity" signal
- **Telegram comments:**
  - names with digits
  - AI-generated avatars
  - very high daily comment counts
  - the same narrative pushed across many channels (DFRLab)
- **Facebook:** Page transparency data (recent creation, name changes, admin countries not matching the topic).

## Ranking

Judgment on news audience × bot severity × feasibility ÷ legal risk:

| Rank | Platform | Rationale |
|---|---|---|
| 1 | Bluesky | Small US news reach (1%), but the best signals of any platform (open API, CORS `*`, `createdAt`, counts, a native `bot` label) and lowest legal risk. |
| 2 | Hacker News | Not measured by Pew, but almost no effort (no rate limit, green names) and essentially no legal risk. |
| 3 | Mastodon / fediverse | Full account object with `bot` flag over open APIs, but small (743K monthly users). Needs a host permission per server. |
| 4 | Threads | 3% (2025) and 400M+ users, real reply spam. Official API useless for this; Meta litigation risk. |
| 5 | Facebook | Biggest audience (40%) and serious slop problem, but fragile page structure and the BrandTotal precedent. |
| 6 | Truth Social | 55% of its users get news there, but bot evidence is thin, Cloudflare blocks, and the ToS bans scripts. |
| 7 | Telegram | 1B+ users and the strongest academic bot evidence, but the web client exposes almost no account signals. |
| 8 | Instagram / TikTok | 23% / 20% reach. Not researched in depth. Same Meta risk for Instagram. |
| 9 | Nextdoor | 8% reach, but address-verified accounts mean a low bot problem, and it's login-only. |
| 10 | LinkedIn | 6% reach. The ToS bans overlays outright, it scans for extensions, and it sues aggressively. Don't build this. |
| – | WhatsApp Channels, Discord, Substack Notes, Gab | Dropped (reasons at top). |

## Phasing (suggestion)

- **Next:** Bluesky and Hacker News.
- **After that:** Mastodon (optional host permission requested per server, server-reputation signal), then Threads only after a legal review.
- **Defer:** Facebook, Truth Social, Telegram, Instagram/TikTok (after YouTube), Nextdoor.
- **Do not build:** LinkedIn.

## Bluesky: extension, labeler, or both

Recommendation: **extension first.** Treat a labeler as a separate, later decision.

- **Extension.**
  - Effort: low. Reuse the scoring engine; `getProfiles` batching plus the feed's author objects supply the signals.
  - Gives per-account reasons in a hover card and keeps scoring local.
  - Desktop web only.
- **Labeler.**
  - Effort: high. Run an Ozone server, score the whole network continuously from the live event stream, and handle appeals.
  - Reaches mobile users, who are most of Bluesky.
  - Costs: only fixed label text, no per-account reasons. Labels are public, which breaks the local-only model and creates harassment and defamation exposure. Users must opt in, competing for 19 slots.
- **Both:** only if mobile reach becomes a goal. Inference: a public "patterns of automation" label is a reputational liability that a local badge isn't.

## Gaps

- No official Bluesky AppView read limit; the "3,000 per 5 min" figure is unverified.
- No official Threads 500M figure.
- Threads, Facebook, LinkedIn and Truth Social in-session JSON shapes (including Threads join-date display) weren't tested in a browser.
- Algolia HN rate limit not verified.
- Meta AI-label policy and Graph API limits not re-fetched.
- No bot-prevalence data for Truth Social, Hacker News or Mastodon for 2024–26.
- Instagram, TikTok, Nextdoor and Rumble only researched at a summary level.
- No precedent found for community reaction to bot-detection labelers on Bluesky.
