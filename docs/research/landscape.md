# Product landscape: existing bot-detection tools

Date researched: 2026-10-22

## Summary and verdict

- No in-feed bot badge for X, Instagram, TikTok, Reddit or YouTube both still works and is well regarded.
- The 2018–2023 generation (Bot Sentinel, BotSight, Botometer, SparkToro, BotDefense) is dead or frozen, mostly because of the 2023 X and Reddit API changes.
- The live in-feed tools are hobby extensions with 6–131 users each. The only newcomer with adoption, Pangram (~40,000 users), judges whether *text* is AI-written, not whether the *account* is automated.
- Instagram, TikTok and YouTube have no in-feed tool of any kind; only paste-a-handle marketer audits exist for Instagram and TikTok.
- Platform-native labels (X "Automated", Reddit "[App]") only cover bots that opt in.
- The main trust risk in this category is false positives: Bot Sentinel was sued for defamation and Pangram flagged the Pope's account.

Install counts and ratings come from store pages fetched on 2026-10-22 unless marked otherwise. "Search snippet" means the figure was seen only in search-result text, not on the page itself. Store pages showed no written reviews, so review complaints could only be assessed where review text was visible (Bot Sentinel on Firefox).

## Older tools (2018–2023 generation)

| Tool | Platforms | In-feed or paste a handle | Signals (if disclosed) | Status today | Price / installs |
|---|---|---|---|---|---|
| **Botometer X** (Indiana University's OSoMe lab) | X | Paste a handle (web) | BotometerLite model using account metadata | **Archival only.** Scores were calculated in advance from data collected before June 2023. No records exist for accounts created after May 31, 2023, and coverage of older accounts is incomplete. The team says the model predates generative AI ([OSoMe, 2024-02-21](https://osome.iu.edu/research/blog/introducing-botometer-x)). The site loads, but live status is not verified. | Free web tool. A bulk API via Botometer Pro was "planned" with no date. |
| **Bot Sentinel** | Twitter | In-feed badge (extension) plus a public database | Machine-learning classifier; details not disclosed | **Effectively dead for X.** Twitter threatened to revoke its API access in Aug 2022 ([Wikipedia](https://en.wikipedia.org/wiki/Bot_Sentinel)). Firefox add-on: v2.1.6, last updated Nov 11, 2022; only twitter.com permissions, none for x.com ([AMO](https://addons.mozilla.org/addon/bot-sentinel/)). The Chrome listing returned an empty page (possibly removed; not verified). botsentinel.com returned 403. | Free, donation-funded. Firefox: 1,199 users, 4.0★ from 133 reviews. Chrome (old search snippet, v2.1.5, March 2022): about 10,000 users, 3.6★ from 126. |
| **BotSight** (NortonLifeLock) | Twitter | In-feed: a bot-probability % beside each handle | Not disclosed | **Presumed dead (inference).** botsight.norton.com no longer resolves (DNS failure). Last official mention: a [Norton community post, Nov 2020](https://community.norton.com/t/identify-fake-twitter-accounts-with-botsight/235363) listing Chrome, Firefox and iOS. | Was free |
| **SparkToro Fake Followers Audit** | Twitter | Paste a handle | Its "fake" count included inactive accounts | **Discontinued.** It ended when Twitter shut its free API ([SparkToro](https://sparktoro.com/support/audience-tracking-is-paused)). | n/a |
| **Twitter Audit** | Twitter | Paste a handle (OAuth sign-in) | "% real followers"; method not disclosed | **Probably non-functional (inference).** The site loads, but its "audits yesterday" counter reads 0 and the recent-audits list is empty ([twitteraudit.com](https://www.twitteraudit.com/)). | First audit free |
| **MetaBot for Twitter** | X | In-feed: red background on replies | Developer's hand-kept list of "Kremlin bots" | Listed. v0.7.19, last updated May 30, 2024; whether it works on x.com is not verified ([CWS](https://chromewebstore.google.com/detail/metabot-for-twitter/cooadmmiojjmmfifkcainbnmhghfcbfi)) | Free. About 2,000 users, 4.1★ from 43 |
| **BotDefense** (Reddit) | Reddit | Moderator-side bans only | Ban list built from user submissions | **Shut down July 2023** over Reddit's API changes. At the end it served 3,650 subreddits and its ban list held 144,926 accounts ([Slashdot / Ars Technica](https://tech.slashdot.org/story/23/07/09/1757230)). | n/a |
| **Reddit Enhancement Suite** | Old Reddit | User tags you add by hand (no bot detection) | Manual | In maintenance mode since Jan 2022 ([AlternativeTo](https://alternativeto.net/news/2022/2/reddit-enhancement-suite-will-go-on-life-support-maintenance-mode--no-new-features-implemented/)). Never supported new Reddit. | Free |
| **Fakespot** (Mozilla) | Product reviews, not social | n/a | n/a | **Shut down July 1, 2025.** Firefox's built-in Review Checker stopped June 10, 2025 ([Linuxiac](https://linuxiac.com/mozilla-shuts-down-pocket-and-fakespot-services/)). | n/a |
| Botcheck.me (UC Berkeley), Botson | Twitter | Button on the profile | Botometer API | Defunct (inference: both depended on Twitter API access that is gone) | n/a |

Not found or not verified: **Hoaxy** (current status), **Bot Detective** (no extension by that name found), **FollowerAudit**, **u/BotBust**, and any "Is It A Bot" site.

## Bot Bouncer (Reddit), the successor to BotDefense

- **What it is.** An app on Reddit's own developer platform that moderators install. It bans accounts already classified as bots in subreddits where it is installed. Accounts are submitted to r/BotBouncer and judged by a mix of automated checks and human review. Each automated "evaluator" targets one style of bot and fires only if all of its checks pass, and roughly half of submissions go to a human. Open source ([wiki via redlib](https://redlib.iamkroot.duckdns.org/r/BotBouncer/wiki/index)).
- **Who sees anything.** Moderators only. Ordinary users get no badge, and no public copy of the bot list was found.
- **Status.** A "Degraded" post from Bot Bouncer's developer said existing subreddits had been fixed (v0.12.44), but new subreddits couldn't install the app. Database updates were not syncing down to subreddits because of a June 18 problem on Reddit's developer platform. The year of that post is not confirmed, and nothing was found saying it was fixed.
- **Policy.** A March 2026 r/modnews post said third-party ban bots lose bans based on which communities an account participates in, while developer-platform apps like this one remain ([r/modnews](https://redlib.groet-infra.nl/r/modnews/s/bD7Sn27TwD)).
- **Reception.** Moderators recommend it, but this is anecdotal ([thread snapshot, Feb 2026](https://reddit.sentinel-team.org/posts/1r8ffra/snapshots/2026-02-20T10%3A52%3A20.11219Z)).

## Newer in-feed extensions (2024–2026)

All of these are tiny. With one rating or none, review complaints can't be assessed. Every accuracy figure below is the developer's own claim.

| Extension | Platform | What it shows in the feed | Signals | Installs / rating / last update | Price |
|---|---|---|---|---|---|
| **X Bot Detector** (Boere Labs) [CWS](https://chromewebstore.google.com/detail/dnmhjhbckegfgbgkhnggnoijdiikdgaa) | X | Coloured badges: Likely Bot (red), Suspicious (amber), Mild Signals (blue), AI Text (violet) | Reads X's internal API responses where available. 36 account, content, engagement, source and timing heuristics, 9 reply-swarm checks, 15 AI-text signals. Runs locally. | 52 users, 3.0★ from 1, v3.4.0, 2026-07-06 | Free (no price listed) |
| **X Bot Detector** (mobucheeri) [CWS](https://chromewebstore.google.com/detail/fminbiljddoiikhamafjkfklnppbgjep) | X | 0–100 score on profiles; marks on suspicious reply cells and usernames | XGBoost model trained on 37,438 accounts, self-reported F1 0.8076; training data from 2018–2020. Reply threads use only a username-pattern check, and verified accounts are always marked typical. Sends profile features to a Hugging Face Space. MIT-licensed. | 131 users, 5.0★ from 1, v1.1.0, 2026-08-01 | No price listed |
| **AuthTag** | X | Real / Bot / AI-likely badges (per a search snippet) | Profile signals | **The AMO listing returns 404** (removed) | n/a |
| **Slopsieve** [chromeboard](https://chromeboard.com/extension/slopsieve-fnmnpjakbcimkgmbdjdjgpnipcfkmckk) | X, Reddit, Hacker News | Flags or filters bots, "AI slop" and low-quality accounts | "AI-powered" model running in the browser | 7 users, 2026-09-02 | Not listed |
| **Redd-Eye** [AMO](https://addons.mozilla.org/firefox/addon/redd-eye/) | Reddit (old and new) | Colour-coded outlines and popups | Local bot-behaviour and AI-text checks with sensitivity sliders; open source | 34 users, 5★ from 1, v5.2.0, 2026-04-16 | Free |
| **TrueVoice for Reddit** [chromeboard](https://chromeboard.com/extension/truevoice-for-reddit-bdfejkkcmeibebehgimopidpdgdkkjmi) | Reddit | Green / yellow / red trust dot beside usernames, plus a hover card | Account age, karma, subreddit spread, comment variety | 59 users, v1.0.2, 2026-02-22 | Free, open source |
| **Bot Hider** [CWS](https://chromewebstore.google.com/detail/bot-hider/kecfdikaeaglgphdfnbimecfnfnpjlap) | Reddit ("Reddit first") | Highlights matched comments | An unnamed "community-maintained blacklist" | 8 users (chromeboard), no ratings, v0.1.2, 2026-02-19 | Free |
| **Reliable Reddit** [CWS](https://chromewebstore.google.com/detail/hhhlpbofpofmikalckhplbinjlpflpmm) | Reddit | Account age and karma beside the poster; highlights comments that mention "AI" or "bot" | Metadata only; AI-image check needs your own Hugging Face token | 6 users, 4.0★ from 1, v1.2, 2026-10-21 | Free |
| **Pangram AI Detection** [CWS](https://chromewebstore.google.com/detail/pangram-ai-detection/eakpippijmmohmdlpgcjnipolcgciaga) | X, LinkedIn, Substack, Reddit, Medium | Human / AI-Assisted / AI label on each **post**, not the account; sidebar "feed health" breakdown | Commercial AI-text classifier. Vendor claims a 1-in-10,000 false-positive rate. | **About 40,000 users, 4.6★ from 30**, v2.18.13, 2026-10-21. Firefox: 1,145 users, **2.4★ from 7** | In-app purchases. TechCrunch cites a $20/month web subscription ([TechCrunch, 2026-07-29](https://techcrunch.com/?p=3147680)) |
| AI Detector for X, TweetDetective, Kitha | X | AI-probability badge per tweet | Text classifiers | AI Detector for X: 27 users. Others not verified. | Freemium, e.g. 50 scans/day free |
| X account-location flag extension (Rhys Sullivan) | X | Country flag beside each username | X's own "account based in" field | GitHub only, no store release ([Digital Trends, 2025-11-23](https://www.digitaltrends.com/social-media/this-chrome-extension-shows-x-profile-locations-right-in-your-feed/)) | Free |

Criticisms of Pangram (secondary sources):

- It flagged posts from Pope Leo XIV's official account as AI ([Decrypt](https://decrypt.co/?p=365151)).
- It only works on text over about 50 words, and it needs full access to your feed ([Substack critique](https://marcwatkins.substack.com/p/how-an-ai-detector-made-me-trust)).
- TechCrunch found it flagged sentences a human had fully rewritten.

YouTube has only userscripts, which need Tampermonkey or Violentmonkey:

- **YouTube Bot Comments Filter**: matches display-name patterns; 43 installs ([ScriptCat](https://scriptcat.org/en/script-show-page/7075)).
- **YT Comment Filter**: keyword and regex filters, red border mode, about 20 installs ([Greasy Fork](https://greasyfork.org/id/scripts/557464-youtube-comment-filter)).
- **Hide Bot Comments**: known spam phrases; last updated Oct 2022, likely broken ([Greasy Fork](https://greasyfork.org/be/scripts/440045-hide-bot-comments)).

Bluesky:

- **Bluesky bot checker** (Simon Willison, Sep 2026): paste a handle. Signals include replies seconds apart, accounts that only reply to bigger accounts, and posting times ([blog](https://simonwillison.net/2026/Sep/27/bluesky-bot-check/)).
- **Bluesentry** (Chrome): removed from the store and flagged "could be malicious".

## Instagram and TikTok follower checkers (paste a handle; none work in the feed)

- **HypeAuditor**: paid plans about $299/month (Basic) and $499/month (Pro) on annual billing, plus a monthly free audit and free standalone tools. These figures come from third-party review sites ([creator-hero](https://www.creator-hero.com/blog/hypeauditor-pricing-and-review)).
- **Modash**: free Instagram-only fake-follower check, no signup ([modash.io](https://www.modash.io/fake-follower-check)). The paid product also covers TikTok and YouTube from $199/month annual or $299/month monthly (older blog figure).
- **inBeat**: Instagram and TikTok fake-follower analysis. A competitor's review says the free tier requires following inBeat's own account ([Influencer Hero review](https://www.influencer-hero.com/de/blogs/inbeat-fake-follower-check-tool-review-benefits-alternatives)). Not verified first-hand.
- **Other free checkers**: Heepsy, Collabstr and ViralMango offer free TikTok checks. Influencer Hero's free Chrome extension shows a fake-follower % on an Instagram profile, but it is a marketer's audit, not a feed badge ([Influencer Hero](https://www.influencer-hero.com/br/resources/free-influencer-audit-browser-extension)).
- **Signals** these tools disclose: engagement out of line with follower count, sudden growth spikes, generic comments, follower quality. None publishes a methodology or accuracy figure.

## Labels the platforms apply themselves

### X

- **"Automated" label.** The bot's operator turns it on, and X's automation rules require it for bots. It shows under the name and handle and may appear on posts ([X Help](https://help.x.com/en/using-x/automated-account-labels); the page returned 403, so this is from the search snippet, which still described the feature as a test). Launched 2021 ([TechCrunch](https://techcrunch.com/2021/09/09/twitter-introduces-a-new-label-that-allows-the-good-bots-to-identify-themselves/)).
- **"About this account."** Rolled out Nov 2025. Shows the country the account is based in, join date, username changes and which app store it connects through. You reach it by tapping the profile's "Joined" date; nothing appears in the feed. Users have reported wrong countries, and VPN users get a warning ([TechCrunch, 2025-11-21](https://www.techcrunch.com/2025/11/21/x-begins-rolling-out-the-about-this-account-feature-to-users-profiles/)).
- **Community Notes.** Not a bot label. AI note writers were piloted from July 2025, and eight AI contributors wrote 50.3% of visible notes over three weeks in May (year not stated) ([Indicator](https://indicator.media/p/8-ai-bots-now-write-50-of-x-s-community-notes)).

### Reddit

An **[App]** tag for registered "good bots", announced in March 2026. Unregistered accounts that look automated may be asked to prove a human is behind them; Reddit says this will be rare. Reddit says it removes an average of 100,000 bot and spam accounts per day ([Social Media Today, 2026-03-25](https://www.socialmediatoday.com/news/reddit-implements-new-app-label-to-identify-bot-profiles/815758/); [Shopifreaks](https://www.shopifreaks.com/reddit-launches-human-verification-for-suspected-bot-accounts-and-labels-legitimate-automated-accounts/)). The tag appears on profiles from March 31, 2026, with a registration deadline in June (secondary sources).

### Bluesky

- Developer guidance asks bots to self-label with the value `bot` (seen only via a third-party guide; the official page was not fetched).
- Third-party "labelers" (moderation services anyone can run and users subscribe to) can attach badges that the app itself displays. This is the only platform where an in-feed bot badge is a supported built-in mechanism.
- Live labelers: @aimod.social labels AI **imagery** and @skywatch.blue is an independent labeling service. Cornell Tech's research labeler surfaces behaviour signals (bio changes, follow/unfollow churn, posting rate) rather than verdicts ([Cornell](https://s.tech.cornell.edu/labeler/)), but it has no confirmed public handle or live status.
- **No confirmed public labeler labels accounts as bots.**

### Meta (Instagram, Threads, Facebook)

Labels AI-generated *content* (announced 2024). No label for bot *accounts* was found.

### TikTok, YouTube

None found. YouTube's controls are on the creator side only: keyword filters, blocked links, "strict" moderation.

## Verdict per platform

| Platform | Working, well-regarded in-feed bot badge? |
|---|---|
| **X** | **No.** Bot Sentinel and BotSight, the old leaders, are dead. Botometer X is a frozen archive (paste a handle, pre-June-2023 accounts only). What remains is two "X Bot Detector" extensions with 52 and 131 users and one rating each, plus AI-*text* labellers (Pangram, about 40,000 users). The native "Automated" label only catches bots that opt in. |
| **Instagram** | **No.** Only paste-a-handle follower audits for marketers; no in-feed tool found. |
| **TikTok** | **No.** Same as Instagram. |
| **Reddit** | **Partly.** Bot Bouncer is the best-regarded tool, but only moderators see it and only in subreddits that install it, and it has had reliability problems. Reddit's native [App] tag covers only registered good bots. Consumer extensions (Redd-Eye, TrueVoice, Bot Hider) have 8–59 users. |
| **YouTube** | **No.** Only small userscripts that match name or phrase patterns. |
| Bluesky (for reference) | The platform supports bot badges through labelers, but no bot-labelling labeler was found in use. |

## Gaps in the landscape (inferences)

1. No tool that scores accounts in the feed has meaningful adoption. The largest, Pangram, scores text, not accounts.
2. Instagram, TikTok and YouTube have no in-feed tool of any kind.
3. Most ML models were trained before LLMs; the mobucheeri X Bot Detector says so explicitly, and so does OSoMe for Botometer X.
4. Since the 2023 API changes, tools that still work read the page or the platform's internal APIs in the browser. That makes them fragile when layouts change, and it may conflict with platform terms (not verified).
5. False positives are the main trust risk: the Bot Sentinel defamation suit and the Pangram/Pope incident are examples.

**Confirmed vs. inferred.** Confirmed from primary pages: install counts, versions, dates and descriptions taken from store listings; Botometer X's data cutoff; the Fakespot, SparkToro and BotDefense shutdowns; Reddit's [App] tag. Inferred: BotSight dead (domain gone), Twitter Audit non-functional, Bot Sentinel's extension broken on x.com (no x.com permission, last update 2022, a "not working" review in Apr 2024), Botcheck.me and Botson defunct.

## Gaps

- botsentinel.com could not be fetched (403), so whether Bot Sentinel still runs anything is unknown. Its Chrome listing loaded empty.
- The X Help Center returned 403, so the current wording of the "Automated" label rules is unverified.
- Botometer X is reachable, but the page didn't render and live scoring is unconfirmed.
- No status found for Hoaxy, FollowerAudit, u/BotBust, "Bot Detective" or "Is It A Bot".
- Bot Bouncer: no install count, the date of the "Degraded" status post, and the GitHub repo URL are all not verified.
- No public Bluesky labeler that labels bots was confirmed. Bluesky's official bots documentation was not fetched.
- Store-listing figures for TweetDetective, Kitha, the Influencer Hero extension and SlopSieve (chromeboard only) were not checked first-hand.
- The App Store was not searched, so whether any iOS app currently does in-feed bot checks is unknown. BotSight's old iOS app is presumed gone.
- Store pages showed no written reviews, so review complaints could only be assessed for Bot Sentinel's Firefox add-on.

## Sources

- [OSoMe: Introducing Botometer X](https://osome.iu.edu/research/blog/introducing-botometer-x)
- [Bot Sentinel (Wikipedia)](https://en.wikipedia.org/wiki/Bot_Sentinel)
- [Bot Sentinel Firefox add-on](https://addons.mozilla.org/addon/bot-sentinel/)
- [Bot Sentinel Firefox reviews](https://addons.mozilla.org/en-US/firefox/addon/bot-sentinel/reviews/)
- [Norton community: BotSight](https://community.norton.com/t/identify-fake-twitter-accounts-with-botsight/235363)
- [SparkToro: Audience Tracking is paused](https://sparktoro.com/support/audience-tracking-is-paused)
- [Twitter Audit](https://www.twitteraudit.com/)
- [MetaBot for Twitter (CWS)](https://chromewebstore.google.com/detail/metabot-for-twitter/cooadmmiojjmmfifkcainbnmhghfcbfi)
- [Slashdot / Ars Technica: BotDefense leaves Reddit](https://tech.slashdot.org/story/23/07/09/1757230)
- [AlternativeTo: RES maintenance mode](https://alternativeto.net/news/2022/2/reddit-enhancement-suite-will-go-on-life-support-maintenance-mode--no-new-features-implemented/)
- [Linuxiac: Mozilla shuts down Pocket and Fakespot](https://linuxiac.com/mozilla-shuts-down-pocket-and-fakespot-services/)
- [r/BotBouncer wiki (via redlib)](https://redlib.iamkroot.duckdns.org/r/BotBouncer/wiki/index)
- [r/modnews, March 2026 (via redlib)](https://redlib.groet-infra.nl/r/modnews/s/bD7Sn27TwD)
- [Moderator thread on Bot Bouncer (snapshot)](https://reddit.sentinel-team.org/posts/1r8ffra/snapshots/2026-02-20T10%3A52%3A20.11219Z)
- [X Bot Detector, Boere Labs (CWS)](https://chromewebstore.google.com/detail/dnmhjhbckegfgbgkhnggnoijdiikdgaa)
- [X Bot Detector, mobucheeri (CWS)](https://chromewebstore.google.com/detail/fminbiljddoiikhamafjkfklnppbgjep)
- [Slopsieve (chromeboard)](https://chromeboard.com/extension/slopsieve-fnmnpjakbcimkgmbdjdjgpnipcfkmckk)
- [Redd-Eye (AMO)](https://addons.mozilla.org/firefox/addon/redd-eye/)
- [TrueVoice for Reddit (chromeboard)](https://chromeboard.com/extension/truevoice-for-reddit-bdfejkkcmeibebehgimopidpdgdkkjmi)
- [Bot Hider (CWS)](https://chromewebstore.google.com/detail/bot-hider/kecfdikaeaglgphdfnbimecfnfnpjlap)
- [Reliable Reddit (CWS)](https://chromewebstore.google.com/detail/hhhlpbofpofmikalckhplbinjlpflpmm)
- [Pangram AI Detection (CWS)](https://chromewebstore.google.com/detail/pangram-ai-detection/eakpippijmmohmdlpgcjnipolcgciaga)
- [Pangram AI Detection (AMO)](https://addons.mozilla.org/en-US/firefox/addon/pangram-ai-detection/)
- [TechCrunch on Pangram, 2026-07-29](https://techcrunch.com/?p=3147680)
- [Decrypt: Pangram flags the Pope's posts](https://decrypt.co/?p=365151)
- [Substack critique of Pangram](https://marcwatkins.substack.com/p/how-an-ai-detector-made-me-trust)
- [AI Detector for X (chromeboard)](https://www.chromeboard.com/extension/ai-detector-for-x-detect-jjhcefifcebclanafccbfelggfdihijk)
- [Fritz.ai: AI detectors for X](https://fritz.ai/best-ai-detectors-for-x/)
- [Digital Trends: X location-flag extension](https://www.digitaltrends.com/social-media/this-chrome-extension-shows-x-profile-locations-right-in-your-feed/)
- [Simon Willison: Bluesky bot check](https://simonwillison.net/2026/Sep/27/bluesky-bot-check/)
- [Cornell Tech labeler](https://s.tech.cornell.edu/labeler/)
- [Cornell Tech internship report (PDF)](https://tech.cornell.edu/wp-content/uploads/2025/09/Internship-Report-Schafer.pdf)
- [YouTube Bot Comments Filter (ScriptCat)](https://scriptcat.org/en/script-show-page/7075)
- [YT Comment Filter (Greasy Fork)](https://greasyfork.org/id/scripts/557464-youtube-comment-filter)
- [Hide Bot Comments (Greasy Fork)](https://greasyfork.org/be/scripts/440045-hide-bot-comments)
- [Lon.TV: YouTube comment bots, May 2025](https://blog.lon.tv/2025/05/20/my-youtube-channels-comment-section-are-infested-by-bots/)
- [Modash fake follower check](https://www.modash.io/fake-follower-check)
- [HypeAuditor pricing review (creator-hero)](https://www.creator-hero.com/blog/hypeauditor-pricing-and-review)
- [Influencer Hero review of inBeat](https://www.influencer-hero.com/de/blogs/inbeat-fake-follower-check-tool-review-benefits-alternatives)
- [Influencer Hero free Chrome extension](https://www.influencer-hero.com/br/resources/free-influencer-audit-browser-extension)
- [X Help: automated account labels](https://help.x.com/en/using-x/automated-account-labels)
- [TechCrunch: Twitter "good bot" label, 2021](https://techcrunch.com/2021/09/09/twitter-introduces-a-new-label-that-allows-the-good-bots-to-identify-themselves/)
- [TechCrunch: X "About this account", 2025-11-21](https://www.techcrunch.com/2025/11/21/x-begins-rolling-out-the-about-this-account-feature-to-users-profiles/)
- [Indicator: AI bots write 50% of Community Notes](https://indicator.media/p/8-ai-bots-now-write-50-of-x-s-community-notes)
- [Social Media Today: Reddit [App] label](https://www.socialmediatoday.com/news/reddit-implements-new-app-label-to-identify-bot-profiles/815758/)
- [Shopifreaks: Reddit human verification](https://www.shopifreaks.com/reddit-launches-human-verification-for-suspected-bot-accounts-and-labels-legitimate-automated-accounts/)
