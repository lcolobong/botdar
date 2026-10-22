# Per-platform feasibility: signal access, APIs, terms of service, store policy

Date researched: 2026-10-22

## Summary and verdict

- A Chrome/Firefox MV3 extension can get account age plus activity counts at low or no extra request cost on **X** and **Reddit**. Both rate as technically *easy*.
- On X, the page's own timeline GraphQL responses already contain the full user object for every post author, so a MAIN-world fetch interceptor reads them passively with no extra requests. The "About this account" query is an extra call that should be hover-only and cached.
- On Reddit, cake day and karma are on the profile, and logged-in `about.json` should still work (the May 2026 block hit unauthenticated access only). The official Data API is closing (new requests end 2026-10-31, full shutdown March 2027), so client-side is the only route.
- **YouTube** is *hard* (commenters expose no age or subscriber count; one innertube call per channel; the Data API bans derived metrics). **Instagram** is *near blocked* (429s even logged in, rotating doc_ids, and Meta has sued extension makers). **TikTok** is *hard* (no join date, signed requests, no API). Native iOS apps are *blocked* (no injection API).
- No precedent exists of X, Reddit, YouTube or TikTok acting against a local in-page annotator. Risk rises with a server, pooled data or resale. Several MV3 country-flag extensions for X have been live in the Chrome Web Store through 2026.
- Store policy: no remote code (remote *data and config* are fine), explicit host permissions, and prominent disclosure if any viewed handle ever leaves the browser.

**Confirmed vs. inference.** Field names below come from a cloned open-source extension, primary docs, or secondary write-ups, as noted. Anything marked *(recollection, not verified)* is the researcher's own knowledge of the UIs and was not checked live on 2026-10-22.

## Account signals visible in the DOM or rendered page (no official API)

### X

- **Profile page (rendered):** display name, handle, bio, location, website, "Joined <Month YYYY>", following/followers counts, post count in the header, verification badge type, avatar, and the "Automated" label where one is set *(recollection, not verified)*.
- **"About this account" panel** (opened by clicking the Joined date, web and app, rolled out from 2025-11-21): country or region the account is "based in", original join date, number of username changes and the last change date, and how it connects to X (e.g. "U.S. App Store", "Google Play") ([TechCrunch](https://techcrunch.com/2025/11/21/x-begins-rolling-out-the-about-this-account-feature-to-users-profiles/)). Secondary sources say a "Created in" country line was removed after launch ([Sorsa blog](https://api.sorsa.io/blog/twitter-account-based-in), secondary).
- **Feed:** name, handle, avatar, badge, relative timestamp, and reply/repost/like/view counts per post. Join date and follower counts are not rendered there.
- **Hover card:** name, handle, bio, following/followers, badge, "followed by…" *(recollection, not verified)*. The X-Posed extension adds its own data to the hover card using the About query.
- **The important part:** X's own timeline GraphQL responses already contain the full user object for every post author, so a MAIN-world script that intercepts `fetch` gets the data with no extra requests. In X-Posed's parser (`extension/src/shared/profile-data.js` in its repo) the 2026 shape reads `user.core.screen_name`, `user.core.created_at`, `user.is_blue_verified`, `user.profile_bio.description`, `user.relationship_count`, `user.tweet_count` and `rest_id`. The older `legacy.*` fields are still present for some data. The schema is changing and parsers need to be defensive.
- **Handle pattern, default avatar, posting cadence:** derivable from what the client already sees. Default avatars use a `default_profile_images` URL *(recollection)*.

### Instagram (web)

- **Profile:** posts, followers and following counts, full name, bio, category, links, verified badge, avatar.
- **"About this account":** Instagram's help center confirms "Date joined" and "Account based in" fields, the latter shown only for some accounts and inferred from activity ([help.instagram.com](https://help.instagram.com/697961817256175)). Whether it is reachable on desktop web in 2026 is **not verified**; older guides say app only.
- **Feed:** username, avatar, badge, timestamp.
- **Hover card on usernames:** avatar, counts and recent posts *(recollection, not verified)*.
- **Embedded data:** a 2026 secondary source says profile data is now taken from the inline `data-sjs` JSON payload on the profile page rather than from `web_profile_info` ([Scrapfly](https://scrapfly.io/blog/posts/how-to-scrape-instagram), secondary).

### TikTok (web)

- **Profile:** handle, nickname, following/followers/likes counts, bio, verified badge, avatar, and a video grid.
- **No join date is rendered.**
- **Embedded JSON:** profile pages embed `__UNIVERSAL_DATA_FOR_REHYDRATION__`. A userscript reads user ID, account creation time and friend count from it ([Greasy Fork](https://greasyfork.org/scripts/537677), secondary). It is commonly reported that `createTime` is sometimes 0 (not verified).
- **Inference:** feed `item_list` responses carry author objects with stats, so interception could work as it does on X. Not verified.

### YouTube

- **Channel "About" dialog:** joined date, subscribers, video count, view count, country, links. These are exposed in innertube as `AboutChannelView.joined_date` ([youtubei.js docs](https://ytjs.dev/api/namespaces/YTNodes/classes/AboutChannelView)). Reaching them takes a `browse` call with the about param `EgVhYm91dA==` ([Invidious commit](https://git.linux.ucla.edu/lug/invidious/commit/12b46bbd4152c997bed9a356b1d042a70eb9b174)).
- **Watch page:** channel name, verified badge, subscriber count.
- **Comments, where most bots are:** handle, avatar, relative time, creator/verified badges. **No account age or subscriber count is shown for commenters**, so each one would need a separate channel fetch.
- **Page data:** `ytInitialData` JSON is in the page.

### Reddit

- **Profile:** karma (post/comment), cake day (account age), avatar, display name, trophies.
- **Since 2025-06-03** users can hide posts and comments from their profile, per community or entirely, and can hide their follower count. Mods still see it. Karma stays visible ([TechCrunch](https://techcrunch.com/2025/06/03/reddit-now-lets-you-hide-content-like-posts-and-comments-from-your-user-profile/)). This **weakens posting-history signals**.
- **Feed and comments:** username, flair, relative time.
- **Hover card on the new UI:** **not verified.**

## Internal and undocumented endpoints from an extension

### X GraphQL (`x.com/i/api/graphql/<queryId>/<Op>`)

**Observed in shipping code:**

- X-Posed (MV3, open source) calls `AboutAccountQuery` (queryId `XRqGa7EeokUU5kppkh13EA` at time of clone).
- It reuses the bearer and CSRF headers it captures from the page, and backs off on `x-rate-limit-reset` / `retry-after`, with a 60 s fallback.
- Its README says rate-limit handling "cannot guarantee protection from X's account enforcement" ([repo](https://github.com/xaitax/x-account-location-device); constants in `src/shared/constants.js`).
- The "Flagged" store listing (v1.1.3, 2026-04-21) says "X rate-limits these lookups after a burst, pausing new lookups for a few minutes" ([CWS](https://chromewebstore.google.com/detail/eodhdolacgjmlabpajcjkhpnldfkhafl)).

**Rate limits:**

- No official per-operation numbers exist.
- twscrape documents "500 req / 15 min" per operation per account but flags it as possibly outdated after 2023 ([PyPI](https://pypi.org/project/twscrape/0.5.0), secondary).
- The account-level read caps from July 2023 were 600 posts/day (unverified accounts) and 6,000 (verified), raised the same day to 1k/10k ([Hootsuite](https://blog.hootsuite.com/social-media-updates/twitter/twitter-limits-the-number-of-tweets-you-can-read-per-day/)). Whether these still apply is not verified.

**Pitfalls:**

- queryIds rotate.
- `x-client-transaction-id` was not verified.
- Lock thresholds are undocumented.
- Several flag extensions run a shared server-side cache specifically to cut per-user calls.

**Simplest approach:** read data passively from timeline responses. Make on-demand About queries only on hover, and cache the results.

### Reddit `.json` and `/user/<name>/about.json`

- **Unauthenticated access** has returned 403 since about 2026-05-29/30. This followed the r/modnews post "Protecting communities from scrapers and platform abuse" (2026-05-28), which said "Logged-in and authenticated access won't be impacted" ([dev.to summary](https://dev.to/tonywangca/why-reddit-blocked-unauthenticated-json-in-2026-and-how-to-still-get-reddit-data-58b9), secondary; the Reddit original could not be fetched).
- **Content scripts on reddit.com:** a same-origin `fetch` sends cookies, so logged-in `about.json` should still work. That is an inference and was not tested.
- **Typical fields** (recollection): `created_utc`, `link_karma`, `comment_karma`, `total_karma`, `has_verified_email`, `is_gold`, `is_mod`, `icon_img`.
- **Rate limit for cookie-authenticated web requests:** undocumented.
- **Other changes:** RSS ends 2026-11-13, and old.reddit is moving to login-only ([TechRepublic](https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/), secondary).

### YouTube innertube (`/youtubei/v1/browse`, `/next`)

- The page's own JS calls these with an embedded key and context, so an extension can call `browse` for a channel's About tab from the user's browser. That is an inference based on Invidious and youtubei.js.
- Bot challenges such as "Sign in to confirm you're not a bot" mainly hit the player endpoint and datacenter IPs. That is secondary/general knowledge and not verified.
- **Pitfall:** one extra request per commenter is needed to get a join date.

### Instagram `api/v1/users/web_profile_info` and the legacy `?__a=1`

- Sources conflict:
  - Scrapfly says it returns 400 "make sure you are logged in" on a growing share of profiles, and 429 within a handful of requests from one residential IP ([Scrapfly](https://scrapfly.io/blog/posts/best-open-source-instagram-scrapers)).
  - An OpenCLI issue reports 429 with an HTML block page **even from an authenticated session** ([GitHub #2456](https://github.com/jackwener/OpenCLI/issues/2456)).
  - A Feb 2026 post says the `i.instagram.com` variant still works with the `X-IG-App-ID` header ([harvestmydata](https://harvestmydata.com/blog/instagram-enrichment-endpoint-proxy-comparison)).
- The logged-in 429 report is the more credible for this use case: it is a reproducible issue report, and the other source sells proxies.
- `?__a=1` is not verified and is presumed dead.
- GraphQL `doc_id`s reportedly rotate every 2–4 weeks ([socialcrawl](https://www.socialcrawl.dev/blog/instagram-scraping-2026), secondary).
- Instagram does not publish thresholds for its "automated behavior" flags.

### TikTok

- The profile JSON is embedded in the HTML, so no extra call is needed.
- Internal API calls need request signatures that the page's JS generates (commonly named X-Bogus/msToken). **Not verified** from a primary or credible secondary source.
- Calling these from an extension outside the page's own flow is fragile.

## Official API status (as of 2026-10)

### X

- **Primary docs:** pay-per-use with prepaid credits ([docs.x.com pricing](https://docs.x.com/x-api/getting-started/pricing)). Rates are given per resource returned:
  - post read: $0.005
  - **user read: $0.010**
  - post create: $0.015 ($0.20 with a URL)
  - owned reads: $0.001
- **Cap:** 3M post reads per monthly cycle; Enterprise above that.
- **Promotions:** $20 in credits after the first purchase, and the first auto-recharge matched up to $50.
- **Legacy tiers (secondary, not on the primary page):** pay-per-use launched Feb 2026. Free is closed to new developers. Basic ($200/mo) moved to pay-per-use after 2026-06-01. Pro ($5,000/mo) migrates after 2026-09-01 ([outstand](https://www.outstand.so/blog/x-api-pricing), [postproxy](https://postproxy.dev/blog/x-api-pricing-2026/)).
- **Indie cost:** about $10 per 1,000 account lookups.

### Reddit

- **Self-service API keys ended 2025-11-11** under the Responsible Builder Policy; access now needs pre-approval ([policy page](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy), which returned 403 to the fetch; mirror of the [r/redditdev post](https://r.datuan.dev/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/noc31sg)).
- **Announced 2026-09-30** (secondary, Reddit originals unreachable):
  - New public-API requests close 2026-10-31.
  - Unregistered apps lose access from 2027-01-12.
  - **All public Data API access ends March 2027.**
  - Devvit is the replacement; commercial data licences are the route for listening tools.
  - Sources: [TechRepublic](https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/), [PPC Land](https://ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register/), [progressiverobot](https://www.progressiverobot.com/2026/10/01/reddit-rss-feeds-public-api-shutdown-ai-bots/).
- **Old figures:** "100 QPM free / $0.24 per 1k calls" are vendor-cited only and now moot.
- **For a new indie product: effectively unavailable.**

### YouTube Data API v3

Docs were updated 2026-10-15 ([quota](https://developers.google.com/youtube/v3/determine_quota_cost), [revision history](https://developers.google.com/youtube/v3/revision_history)).

- **Quota:** 10,000 units/day per project, resetting at midnight PT. `channels.list` costs 1 unit.
- **Changed 2026-06-01:** `search.list` now has its own bucket, 100 calls/day at 1 unit each (previously 100 units per call from the shared pool).
- **`channels.list` returns:**
  - `snippet.publishedAt` (creation date), `country`, `customUrl`, thumbnails
  - `statistics.subscriberCount`, "rounded down to three significant figures"
  - `hiddenSubscriberCount`, `videoCount` (public videos only), `viewCount`
  - `brandingSettings` ([channels resource](https://developers.google.com/youtube/v3/docs/channels))
- **viewCount changes:** since about 2026-08 a view counts from playback start, and Shorts since 2025-03-31.
- **Policy catch (YouTube API Services Developer Policies, updated 2026-10-15):**
  - III.E.4.h prohibits using API data to "create new or derived data or metrics" and requires any non-YouTube metric to be labelled as such.
  - III.E.4 limits storage to 30 days.
  - III.E.6 prohibits scraping ([developer policies](https://developers.google.com/youtube/terms/developer-policies)).
  - **A bot score built from API data is arguably a "derived metric".** That is an inference; ask Google or counsel. A derived-metrics allowance exists (III.L) only for audited analytics developers.

### Instagram

- **Basic Display API ended 2024-12-04.** "There will no longer be a set of Instagram APIs for consumer developer apps" ([Meta blog](https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api)).
- **Business Discovery** (Graph API) returns follower and media counts for other **Business/Creator** accounts only, not age-gated ones. It must be called through your own IG professional account's token ([docs](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery)).
- Personal accounts cannot be looked up, so it is **not usable for general bot checks.**

### TikTok

- **Research API:** academic or non-profit researchers only, "independent of commercial interests" ([product page](https://developers.tiktok.com/products/research-api)). The page lists US, EEA, UK, Canada and Switzerland. Search snippets of an earlier version and the 2026-08-04 codebook scope note omit Canada, so the sources disagree.
- **Display API `user/info`:** returns stats only for the user who authorized the token; there is no lookup by user ID ([docs](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info)).
- **Not usable** for a hobby product.

**Usable by an indie product:** X (paid per lookup) and YouTube (free quota, with the derived-metric policy risk). Nothing practical for Reddit after March 2027, Instagram (personal accounts) or TikTok.

## Terms of service and legal risk for DOM-reading annotation

### Terms

- **X:** "access or search … by any means (automated or otherwise) other than through our currently available, published interfaces"; "crawling or scraping the Services in any form, for any purpose without our prior written consent is expressly prohibited" ([ConductAtlas copy, captured 2026-10-10](https://conductatlas.com/platform/x/x-terms-of-service/acceptable-use-and-scraping-prohibition/); x.com/tos returned 402). Liquidated damages of $15,000 apply for accessing more than 1,000,000 posts in 24 h, effective 2024-11-15 ([Knight Institute](https://knightcolumbia.org/content/knight-institute-says-xs-new-terms-of-service-will-stifle-independent-research)).
- **Instagram:** prohibits collecting information "in an automated way without our express permission" ([help.instagram.com](https://help.instagram.com/581066165581870), as quoted via search). Meta's Automated Data Collection Terms took effect 2024-10-07 (secondary).
- **YouTube ToS:** no automated access ("robots, botnets or scrapers") without prior written permission, except search engines following robots.txt ([YouTube ToS](https://www.youtube.com/static?template=terms)).
- **Reddit:** the User Agreement could not be fetched. Secondary sources say scraping needs prior written consent.
- **TikTok:** the US ToS was rewritten 2026-01-22 under TikTok USDS Joint Venture ([Open Terms Archive](https://opentermsarchive.org/en/memos/tiktok-rewrites-all-terms-following-usa-operations-transfer/)). Scraping clause text **not verified**.

### Precedents

- **Meta v. BrandTotal** (N.D. Cal. 3:20-cv-07182). **The closest analogue: a browser extension (UpVoice) collecting from users' logged-in Facebook/Instagram sessions.**
  - 2022-05-27: summary judgment for Meta on **breach of contract**.
  - BrandTotal won on the CFAA and Cal. Penal Code §502 claims for its 2021 collection.
  - Settled for a "significant" sum, Oct 2022.
  - Sources: [docket](https://www.docketalarm.com/cases/California_Northern_District_Court/3--20-cv-07182/Meta_Platforms_Inc._v._BrandTotal_Ltd._et_al/369/), [TechCrunch](https://techcrunch.com/2022/10/03/meta-settles-lawsuit-for-significant-sum-against-businesses-scraping-facebook-and-instagram-data).
  - The difference from this product: BrandTotal paid users and sent the data to its servers for commercial resale.
- **Meta v. Bright Data** (Jan 2024): Meta's terms bind only logged-in users scraping; logged-out scraping of public data was not a breach ([Zyte](https://www.zyte.com/blog/california-court-meta-ruling)). **An extension runs logged in, which is the losing side of that line.**
- **Unfollow Everything:** Meta sent a cease-and-desist in 2021 and the developer shut it down. Zuckerman v. Meta (filed 2024-05-01) was dismissed as **unripe**, not on Section 230 merits, around Nov 2024 ([Knight Institute](https://knightcolumbia.org/content/federal-judge-says-challenge-in-zuckerman-v-meta-cannot-go-forward-yet), [Goldman](https://blog.ericgoldman.org/?p=27056)).
- **NYU Ad Observatory:** on 2021-08-03 Facebook disabled the researchers' accounts, apps and Pages over its opt-in Ad Observer extension. The FTC rejected Facebook's consent-decree justification ([The Register](https://www.theregister.com/2021/08/04/facebook_research_lockdown/)). The enforcement was account bans, not a lawsuit.
- **X v. CCDH:** dismissed 2024-03-25 under anti-SLAPP; appeal 24-2643, outcome not verified.
- **X v. Bright Data:** dismissed 2024-05-10, later partly revived on server-strain claims ([MediaPost](https://www.mediapost.com/publications/article/401510/x-corp-can-revive-scraping-battle-with-bright-dat.html)).
- **Reddit:** sued Anthropic (Jun 2025) and Perplexity/scrapers (Oct 2025). These are bulk-scraping cases, not extensions (secondary).

**No precedent found of X, Reddit, YouTube or TikTok suing or forcing removal of a local in-page annotator.** Counter-evidence: several MV3 extensions annotating X accounts with country flags have been live on the Chrome Web Store through 2026 (X-Posed, Flagged, Country Revealer). Reddit Enhancement Suite ran for years and appears to have stalled (last update Jan 2025 per its Edge listing), with no reported legal action.

**Inference on risk:** Meta has the most demonstrated enforcement against extensions specifically (contract suits, cease-and-desists, account bans). For X, Reddit and YouTube the practical risk is account rate-limits or locks for the user, plus endpoint breakage. Litigation risk rises if data is sent to a server, pooled across users, or sold.

## Store policy constraints

### Chrome Web Store

- **Remote code:**
  - Banned: `<script>` tags to remote resources, `eval` of fetched strings, and interpreters that run fetched commands.
  - Allowed: remote config and data, as long as the logic ships in the package ([MV3 requirements, updated 2024-04-03](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)).
  - A server-side scoring model is fine. A downloaded JS model is not.
- **Single purpose:** "narrow and easy to understand" ([quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines)). One extension covering five sites with a single "bot likelihood" purpose fits. Bundling unrelated features does not.
- **Host permissions:** "Reviews may take longer for extensions that request broad host permissions". Obfuscation is banned; minification is allowed. Reviews take days to a few weeks ([review process, 2021-12-10](https://developer.chrome.com/docs/webstore/review-process)). List the domains explicitly, not `<all_urls>`.
- **Limited Use:**
  - Data may be used only for the single purpose; no sale.
  - No human reading of user data without consent.
  - "Collection and use of web browsing activity is prohibited" except for a prominently described user-facing feature.
  - The rules "also apply to scraped content" ([Limited Use, 2022-11-01](https://developer.chrome.com/docs/webstore/program-policies/limited-use)).
  - **Sending each viewed handle to a server counts as browsing-activity data** that must be disclosed. A shared cache like X-Posed's (on by default) needs this disclosure.

### Firefox (AMO)

- "Add-ons must be self-contained and not load remote code for execution."
- Pre-minified source must be submitted; obfuscation is banned.
- Firefox 140+ consent uses manifest declarations ([AMO policies](https://extensionworkshop.com/documentation/publish/add-on-policies/)). New extensions must declare `browser_specific_settings.gecko.data_collection_permissions` as of 2025-11-03 ([AlternativeTo](https://alternativeto.net/news/2025/10/mozilla-will-soon-require-all-firefox-extensions-to-disclose-data-collection-practices), secondary).

### Safari

- Distributed only inside an App Store app.
- MV3 is supported from Safari 15.4 ([WWDC22 10099 index](https://nonstrict.eu/wwdcindex/wwdc2022/10099/)).
- Guideline 4.4.2: "should not claim access to more websites than strictly necessary".

## iOS options

### Safari Web Extension on iOS (iOS 15+)

- Must be packaged in an app.
- Users opt in per site, and Safari shows a consent dialog listing the sites.
- Background pages must be non-persistent on iOS; with a persistent page the extension fails to load.
- WebRequest and context menus may be unavailable ([WWDC21 10104](https://developer.apple.com/videos/play/wwdc2021/10104/)).
- Works only on x.com, instagram.com and the other sites **inside Safari**. Universal links push most users into the native apps (inference).

### Share or Action extension

- The user shares a profile URL from the X, IG or TikTok app (profile share links contain the handle).
- The app then needs a data source. Realistic options are X's paid API (about $0.01 per user) and the YouTube Data API. Reddit's API closes March 2027, Instagram has nothing for personal accounts, and TikTok has nothing.

### Annotating inside the native X/IG/TikTok apps: confirmed not possible

- iOS has no API to inject into or overlay another app's UI. No counter-evidence found.
- *Inference only:* a ReplayKit broadcast extension plus OCR could read the screen. That is user-initiated, impractical, and high review risk.

### App Store Review risk

- **5.2.2:** "If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request."
- **5.1.1(viii):** "Apps that compile personal information from any source that is not directly from the user or without the user's explicit consent, even public databases, are not permitted". A per-account bot score built from third-party profiles fits this wording closely (inference).
- **1.1.1:** a "Defamatory… mean-spirited" exposure risk if you label named people as bots.
- Source: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
- **Inference:** an app wrapping the Safari extension that computes locally and stores nothing server-side is the least exposed. A server-backed lookup app is the most exposed.

## Feasibility rating for a DOM-reading extension

| Platform | Rating | Why |
|---|---|---|
| X | **Easy** (technical); ToS explicitly prohibits scraping | Rich user objects including `created_at` already arrive in timeline responses; About panel adds country, username changes and connection method; several flag extensions are already in the store |
| Reddit | **Easy** | Cake day and karma are on the profile; logged-in `about.json` should work (untested); official API is gone, so it has to be client-side |
| YouTube | **Hard** | Commenters (the bot surface) expose no age or subscriber count; one innertube call per channel; API path has the derived-metric clause |
| Instagram | **Hard, close to effectively blocked** | Logged-in 429s, rotating doc_ids, and Meta's track record against extensions (BrandTotal, Ad Observatory) |
| TikTok | **Hard** | Profile JSON is easy to read, but there is no join date, feed data access is unverified, request signing is required, and there is no usable API |
| Native iOS apps | **Effectively blocked** | No injection API |

## Recommendation

Start with X and Reddit as a Chrome/Firefox MV3 extension.

- **X:** read the user objects X already delivers to the page, call `AboutAccountQuery` only on hover, and keep a local cache.
- **Reddit:** read profile data and logged-in `about.json`, with the same caching.

Both give account age plus activity counts at low or no extra request cost, and neither has a record of acting against in-page annotators. Keep scoring local, or disclose clearly if handles are sent to a server, to stay inside Chrome's Limited Use and Apple's 5.1.1(viii). Add YouTube later only for channel pages, or for commenters on demand. Defer Instagram (most legal and anti-automation risk) and TikTok (thin signals, fragile access). On iOS, the only path consistent with the guidelines is shipping the same extension as a Safari Web Extension. A Share-extension app backed by server-side lookups runs into 5.2.2 and 5.1.1(viii) directly.

## Gaps

- Reddit's primary announcements (2025-11-11, 2026-05-28, 2026-09-30) and its User Agreement could not be fetched; all of those dates are from secondary sources.
- X's ToS page (402) and current rate limits for internal GraphQL; whether the 2023 daily read caps still apply.
- Fields shown in hover cards on X, Instagram, TikTok and new Reddit.
- Whether Instagram's "About this account" is available on desktop web in 2026.
- TikTok's ToS scraping clause, its signature headers, and whether feed responses include author stats.
- Rate limits for cookie-authenticated Reddit `about.json` and YouTube innertube `browse`.
- Outcome of the X v. CCDH appeal (9th Cir. 24-2643).
- Exact fields of the Chrome Web Store privacy-practices disclosure form.

## Sources

[docs.x.com pricing](https://docs.x.com/x-api/getting-started/pricing) · [outstand](https://www.outstand.so/blog/x-api-pricing) · [postproxy](https://postproxy.dev/blog/x-api-pricing-2026/) · [TechCrunch About this account](https://techcrunch.com/2025/11/21/x-begins-rolling-out-the-about-this-account-feature-to-users-profiles/) · [Sorsa](https://api.sorsa.io/blog/twitter-account-based-in) · [X-Posed repo](https://github.com/xaitax/x-account-location-device) · [Flagged CWS](https://chromewebstore.google.com/detail/eodhdolacgjmlabpajcjkhpnldfkhafl) · [twscrape](https://pypi.org/project/twscrape/0.5.0) · [Hootsuite](https://blog.hootsuite.com/social-media-updates/twitter/twitter-limits-the-number-of-tweets-you-can-read-per-day/) · [Reddit RBP](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) · [r/redditdev mirror](https://r.datuan.dev/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/noc31sg) · [dev.to Reddit JSON](https://dev.to/tonywangca/why-reddit-blocked-unauthenticated-json-in-2026-and-how-to-still-get-reddit-data-58b9) · [TechRepublic](https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/) · [PPC Land](https://ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register/) · [progressiverobot](https://www.progressiverobot.com/2026/10/01/reddit-rss-feeds-public-api-shutdown-ai-bots/) · [TechCrunch Reddit profile](https://techcrunch.com/2025/06/03/reddit-now-lets-you-hide-content-like-posts-and-comments-from-your-user-profile/) · [YouTube quota](https://developers.google.com/youtube/v3/determine_quota_cost) · [YouTube revision history](https://developers.google.com/youtube/v3/revision_history) · [YouTube channels](https://developers.google.com/youtube/v3/docs/channels) · [YouTube dev policies](https://developers.google.com/youtube/terms/developer-policies) · [YouTube ToS](https://www.youtube.com/static?template=terms) · [youtubei.js](https://ytjs.dev/api/namespaces/YTNodes/classes/AboutChannelView) · [Invidious commit](https://git.linux.ucla.edu/lug/invidious/commit/12b46bbd4152c997bed9a356b1d042a70eb9b174) · [Meta Basic Display EOL](https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api) · [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery) · [Instagram help](https://help.instagram.com/697961817256175) · [Instagram ToU](https://help.instagram.com/581066165581870) · [Scrapfly IG](https://scrapfly.io/blog/posts/how-to-scrape-instagram) · [Scrapfly OSS](https://scrapfly.io/blog/posts/best-open-source-instagram-scrapers) · [OpenCLI #2456](https://github.com/jackwener/OpenCLI/issues/2456) · [harvestmydata](https://harvestmydata.com/blog/instagram-enrichment-endpoint-proxy-comparison) · [socialcrawl](https://www.socialcrawl.dev/blog/instagram-scraping-2026) · [TikTok Research API](https://developers.tiktok.com/products/research-api) · [TikTok user info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info) · [Greasy Fork TikTok](https://greasyfork.org/scripts/537677) · [Open Terms Archive TikTok](https://opentermsarchive.org/en/memos/tiktok-rewrites-all-terms-following-usa-operations-transfer/) · [ConductAtlas X ToS](https://conductatlas.com/platform/x/x-terms-of-service/acceptable-use-and-scraping-prohibition/) · [Knight X ToS](https://knightcolumbia.org/content/knight-institute-says-xs-new-terms-of-service-will-stifle-independent-research) · [BrandTotal docket](https://www.docketalarm.com/cases/California_Northern_District_Court/3--20-cv-07182/Meta_Platforms_Inc._v._BrandTotal_Ltd._et_al/369/) · [TechCrunch BrandTotal](https://techcrunch.com/2022/10/03/meta-settles-lawsuit-for-significant-sum-against-businesses-scraping-facebook-and-instagram-data) · [Zyte Meta ruling](https://www.zyte.com/blog/california-court-meta-ruling) · [MediaPost X v Bright Data](https://www.mediapost.com/publications/article/401510/x-corp-can-revive-scraping-battle-with-bright-dat.html) · [Knight Zuckerman](https://knightcolumbia.org/content/federal-judge-says-challenge-in-zuckerman-v-meta-cannot-go-forward-yet) · [Goldman](https://blog.ericgoldman.org/?p=27056) · [The Register NYU](https://www.theregister.com/2021/08/04/facebook_research_lockdown/) · [Courthouse News X v CCDH](https://courthousenews.com/x-asks-ninth-circuit-to-revive-data-scraping-suit-against-hate-speech-monitor/) · [CWS MV3](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) · [CWS quality](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) · [CWS limited use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) · [CWS review](https://developer.chrome.com/docs/webstore/review-process) · [AMO policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) · [AlternativeTo Firefox](https://alternativeto.net/news/2025/10/mozilla-will-soon-require-all-firefox-extensions-to-disclose-data-collection-practices) · [WWDC21 10104](https://developer.apple.com/videos/play/wwdc2021/10104/) · [WWDC22 index](https://nonstrict.eu/wwdcindex/wwdc2022/10099/) · [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
