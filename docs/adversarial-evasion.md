# Adversarial evasion analysis and the v1.1 countermeasure set

Date: 2026-10-22 · Status: proposal for v1.1 · Owner: maintainer

This document plays the operator of automated and sockpuppet accounts against Botdar's v1 signals
([scoring-spec.md](scoring-spec.md)), then proposes countermeasures ranked by what they cost us and what
they cost the operator. X and Reddit get full treatment; Bluesky is brief. Prices come from vendor and
marketing pages unless marked otherwise, so read them as order-of-magnitude figures, not market data.

## Summary

- **Every v1 feature is an account-level attribute the operator controls or can buy.** Age is bought
  (aged Reddit accounts from about $5), rate is throttled, the follow ratio is bought ($10–55 per 1,000
  followers), and handle, avatar and bio take a few minutes and a free face generator. A moderately
  careful operator scores `typical` today at a cost of a few dollars per account.
- **Operators optimise against the platforms, not against Botdar.** With 1,000 weekly users as the
  90-day target, passing Botdar is worth almost nothing on its own. Botdar is evaded as a side effect of
  evading X's and Reddit's own enforcement, which already sees device, IP and phone signals Botdar never
  will. The exception is that Botdar's weights are public: the repository and the policy file give
  anyone an exact offline oracle to tune accounts until they score just under `some`.
- **What survives evasion is behaviour that costs the operator money to change:** timing (no sleep
  window, machine-regular gaps, bursts within seconds of a parent post), reuse (the same text across
  authors in one thread, the same link domain), and history (an old account that only became active, or
  was renamed and verified, last month). These are what the v1.1 set targets.
- **Recommended v1.1 set (six features, all local):** `thread.nearDuplicateReply`,
  `thread.sharedRareDomain`, `x.gapRegularity`, `x.noSleepWindow` (each timing feature with a Bluesky
  twin), `x.agedRepurposed`, `reddit.karmaSinceFirstActivity`. Text-style signals (generic praise, LLM
  tells, restatement) stay out because their false-positive cost lands on non-native English writers.
- **Two v1 issues found while doing this.** `x.countryLocaleMismatch` compares the account's country
  with the *viewer's* browser region (`regionFromNavigatorLanguage()` in `src/platforms/x/features.ts`),
  not with the account's bio language as the spec says, so a viewer whose browser locale is `en-US` adds
  +0.4 to every account based outside the US. And `x.replyShare` has no producer anywhere in `src/`, so
  it never fires. (Bluesky's `features.ts` does not exist yet either.) The first should be neutralised
  by policy now (`weight: 0`) and fixed in v1.1.

## 1. Threat actors and goals

| Actor | Budget and scale | What they want | What "passing" is worth to them |
|---|---|---|---|
| **X engagement-payout reply farms** | Low budget, high volume. One operator runs tens to hundreds of Premium accounts ($8/month for Premium, $3 for Basic; [tech.co](https://tech.co/news/x-premium-price-increase-grok-3)) through AI reply tools that post "paced like a real person" from the account's own session ([ReplyGuyX listing](https://chromewebstore.google.com/detail/fbnofdcpepbicbjeillhnhbdleaeinbh)) or draft for a human to send ($49.99, [Reply Guy](https://builditn0w.gumroad.com/l/twitter-x-reply-guy)). | Since November 2024 payouts follow engagement from Premium users ([Scroll.in](https://scroll.in/article/1072706/there-is-a-reason-your-x-feed-has-turned-more-toxic-have-you-heard-of-engagement-farming)), so early, high-ranked replies under large accounts. | Small. Their risk is X's reply ranking and its purges (1.7M reply-spam accounts by October 2025; [WION](https://www.wionews.com/technology/x-removed-over-1-7-million-bots-dm-spam-next-says-product-head-nikita-bier-1760344720045/amp)). A badge only lowers clicks among Botdar users. |
| **Crypto and scam reply bots** | Industrial: thousands of throwaway accounts, bought followers, residential proxies at $1–8/GB ([DataImpulse](https://dataimpulse.com/blog/residential-proxy-pricing-comparison/)). X's head of product estimated in 2026 that about 80% of crypto reply activity may be bots ([Digital Today](https://www.digitaltoday.co.kr/cn/view/45611/x-head-of-product-says-80-percent-of-crypto-activity-may-be-bots-spam-not-solvable-by-technology-alone)). | Clicks on a wallet drainer, "recovery" DM or giveaway link. | Low. Accounts are disposable; they evade by volume and churn, not by looking human. v1 already catches these best. |
| **State-aligned persona networks** | Funded and patient. OpenAI describes STORM-2035 generating short comments in batches of about a dozen, posted by accounts posing as residents of target countries ([OpenAI](https://openai.com/index/disrupting-malicious-uses-of-ai-storm-2035-2025)); Bluesky removed 3,619 accounts for suspected influence operations in 2025 ([Bluesky](https://bsky.social/about/blog/01-29-2026-transparency-report-overview)). | Credibility for narratives, apparent local consensus. | Moderate. Journalists and researchers are Botdar's secondary audience, and a badge in a screenshot undercuts a persona with exactly the people it wants to reach. |
| **Reddit karma farms and aged-account resellers** | Low unit cost, wide scale. Accounts sell from $1–15 on marketplaces to about $75 for a 13-year-old account with 5,000+ karma ([Outlook India](https://www.outlookindia.com/amp/story/xhub/featured-insights/5-best-places-to-buy-reddit-accounts-in-2026-ranked-by-account-quality), [Pixelscan](https://pixelscan.net/blog/buy-aged-reddit-accounts/), both vendor-adjacent). One investigator describes a network that farmed by reposting and copying comments for most of a year before posting ads ([Lemmy](https://lemmy.linuxuserspace.show/comment/1934760), anecdotal). | Accounts that clear subreddit karma and age minimums, then resale. | Low for the farmer; higher for the buyer, whose launches and political posts land in exactly the threads Botdar users read. |
| **Astroturf and marketing sockpuppets** | A few to a few dozen aged accounts per campaign, human-written or LLM-assisted, run through antidetect browsers at $7–89/month per 100–150 profiles ([send.win](https://blog.send.win/7-cheapest-antidetect-browsers-that-actually-work-in-2026/)). | "Organic" recommendations in Reddit threads and X replies. | Moderate. A recommendation from a badged account is worthless, so these operators have the strongest Botdar-specific incentive. |
| **LLM persona bots** | Cheap per account once built. fox8 ran 1,140 ChatGPT-driven accounts that Botometer and GPTZero rated human-like; coordination was the only reliable tell ([fox8](https://ar5iv.labs.arxiv.org/html/2307.16336)). | Influence, promotion or payout farming behind realistic profiles. | Moderate and growing. These are the accounts v1 cannot see at all. |

## 2. Evasion catalogue per Botdar signal

### X

| Signal | How an operator defeats it | Cost to the operator | Residual tell that survives |
|---|---|---|---|
| `x.accountAgeDays` | Buy aged accounts, or register, park for a year, then activate. | Aged accounts with 10K+ pre-2022 followers list at $2,000–50,000 ([handles.gg](https://handles.gg/buy-twitter-usernames), seller figures); bare aged shells far less. Parking costs only time. | A recent rename and a recent verification on an old account (About panel); activity that starts years after the join date. |
| `x.postsPerDay` | Throttle to under 10/day of lifetime average; on an aged account the long denominator does it for free. | Nothing on aged accounts; throughput on new ones. | The lifetime average hides a recent spike; short-window cadence (gap regularity, no sleep window) does not. |
| `x.followingRatio` | Follow-back rings among the operator's own accounts, bought followers, follow/unfollow churn to keep `following` under 100 or the ratio under 5. | $10–55 per 1,000 followers, with 30–60% lost within weeks on cheap tiers ([Socialz](https://socialz.ai/blog/buy-twitter-subscribers)); rings are free. | Ring members reply to and amplify each other (fox8's tell), which is visible only at cloud scale. |
| `x.handleNameDigits`, `x.handleTrailingDigits`, `x.handleBigramLL` | Choose a pronounceable custom handle; an LLM can generate thousands. | Seconds. | None. The cheapest v1 signal to defeat. |
| `x.defaultAvatarEmptyBio` | AI-generated face plus an LLM-written bio. | Free. | StyleGAN faces put the eyes at the same position in every image ([arXiv 2401.02627](https://arxiv.org/pdf/2401.02627)); bios repeat a template across a network. Both need image analysis or cross-account comparison. |
| `x.newAndBlue` | Verify an aged account instead of a new one. | $8/month. | `x.agedRepurposed`: a recent verified-since date on an old account. |
| `x.replyShare` (no producer in v1) | Mix in original posts, quote posts and reposts to stay under 90% replies. | One scheduled post per ten replies. | The original posts are generic and repeated, and cadence is unchanged. |
| `x.usernameChanges` | Keep renames under 3; buy accounts that have never been renamed. | Limits handle reuse. | The last-change date: one recent rename on an old account is the aged-market tell. |
| `x.countryLocaleMismatch` | Route through residential proxies in the target audience's country so "based in" matches. | $1–8/GB ([DataImpulse](https://dataimpulse.com/blog/residential-proxy-pricing-comparison/), [Databay](https://databay.com/blog/how-much-do-residential-proxies-cost)). | The "connected via" app-store region can still disagree with the country if the device is foreign. As implemented, the feature mostly flags foreign accounts for the viewer, not operators. |
| X About panel: app-store field | Use the web client, or a phone registered in the target country. | A cloud phone from about $3/month ([ScrapingBee](https://www.scrapingbee.com/blog/anti-detect-browser/)). | Weak; travellers and expats produce the same mismatch. |
| Automated label (`declaredAutomated`) | Never self-declare. | Nothing. | None, which is why declared is a neutral state rather than evidence. |
| Signals only the platform sees: device fingerprint, IP reputation, phone verification, payment instrument, client telemetry, challenge results | Antidetect browsers, residential and mobile proxies, cloud phones, SMS-verification services. | Most of the operator's real spend. | Invisible to Botdar, locally and forever. Platform enforcement, not Botdar, sets the operator's cost floor. |

### Reddit

| Signal | How an operator defeats it | Cost to the operator | Residual tell that survives |
|---|---|---|---|
| `reddit.accountAgeDays` | Buy aged accounts. | $1–75 by age and karma (vendor pages above). | A dormancy gap between cake day and first visible activity, or karma far above what the visible history explains (resellers delete farming history). |
| `reddit.karmaPerDay` | Use an account older than 180 days: the gate removes the feature, so aged accounts are never rate-checked. | Free once aged. | Karma per day since first visible activity rather than since cake day (`reddit.karmaSinceFirstActivity`). |
| `reddit.postToCommentKarma` | Comment farming in large subreddits (short agreeable comments early in rising threads) to balance post karma from reposts. | Automatable; an LLM comment in a default sub is nearly free. | Copied comments: farmers copy earlier top comments in the same or a reposted thread ([The Motte](https://www.themotte.org/post/328/smallscale-question-sunday-for-january-22/57048), anecdotal). |
| Reposts (not a v1 feature) | Repost a subreddit's all-time top posts with the original title. | Free; moderators catch some with Repost Sleuth, which reports 1M+ searches a day ([Patreon](https://www.patreon.com/repostsleuthbot/home)). | Title equal to a top post of the same subreddit. |
| `reddit.generatedName` | Choose a custom name at sign-up. | Seconds. | None. |
| `reddit.noAvatar` | Set any avatar. | Seconds. | None. |
| `reddit.noVerifiedEmail` | Verify with bulk or catch-all email. | Cents per address. | None for Botdar. |
| Profile hiding (since June 2025) | Hide posts and comments from the profile ([TechCrunch](https://techcrunch.com/2025/06/03/reddit-now-lets-you-hide-content-like-posts-and-comments-from-your-user-profile/)). | One setting. | Karma stays visible. A hidden history must count as unknown, never as evidence, or private humans pay for it. |
| Signals only the platform sees: IP, device, vote-ring detection, shadowbans | Proxies, antidetect profiles, spaced votes. | The bulk of real cost. | Invisible. A shadowbanned account's `about.json` may fail; that should lower confidence, never raise the score. |

### Bluesky (brief)

| Signal | How an operator defeats it | Cost | Residual tell |
|---|---|---|---|
| `bsky.accountAgeDays` | Park accounts, or blend into sign-up waves (the November 2024 influx makes join cohorts useless as evidence). | Time. | Cadence from the public `getAuthorFeed`, which costs us nothing and puts no user account at risk. |
| `bsky.followsRatio` | Stay under Bluesky's own follow-farming enforcement, which labels accounts that follow tens of thousands at once ([Bluesky](https://bsky.social/about/blog/01-29-2026-transparency-report-overview)). | Slower growth. | Follow-back rings, cloud only. |
| `bsky.handleDigitsOnBskySocial` | Custom-domain handle, which the feature never fires on. | About $10/year for a domain; subdomains of one domain are free. | Many repliers on subdomains of one cheap domain: a coordination tell visible in a thread. |
| `bsky.noAvatarEmptyBio`, `bsky.declaredBot` | As on X. | Free. | None. |

## 3. Attacks on Botdar itself

- **Making real people look automated.** Account-level v1 features cannot be pushed onto a target: an
  attacker cannot change someone's join date, post rate or following count, and mass-following a target
  only improves the ratio. The new thread-level features can be: a farm pastes a journalist's reply under
  the same post so that "the same text from five accounts" fires on her too. Defences built into the
  proposal: near-duplicate evidence counts only *earlier* matching replies, so the first author of a text
  always scores 0; the `coordination` group cap of 1.5 keeps coordination alone below the `some`
  threshold (prior −2.5 + 1.5 gives p ≈ 0.27); and the independence rule still needs a second group for
  `many`. Impersonation (`jane_doe_news` lookalikes that rightly earn a badge) produces screenshots that
  read as "Botdar called Jane a bot"; the card must always show the handle beside the label.
- **Gaming feedback if it ever leaves the device.** Today "This looks wrong" stays in `storage.local`. If
  a future calibration pools it, an operator installs Botdar on a few hundred browser profiles and marks
  their own accounts as wrongly flagged. Because the policy may always *weaken* features, poisoned
  feedback pushes the maintainer toward damping exactly the features that work. Rule: feedback is triage,
  never a label; labels come from hand review and later platform suspension; per-install weight is
  capped, and installs younger than 30 days are ignored.
- **Detecting the MAIN-world patch to behave differently when observed.** The patch runs in the
  *viewer's* browser, so an operator cannot tell who is watching or serve watchers different content;
  only the platform can see it (`fetch.toString()`, R-14) and could strip fields for such sessions. The
  realistic "observed" attack is offline: the public weights are an exact scoring oracle. Accept that
  (transparency is the product) and prefer features whose evasion costs money or throughput, so knowing
  the threshold does not make passing cheap.
- **Exploiting the quiet feed.** ADR-0017 draws no badge for `typical` or `unknown`, so silence reads as
  "checked and fine". An operator tuned just under 0.30, or one who starves Botdar of data (hidden Reddit
  history, a failing `about.json`, Tier 2 off), gets the same silence as a long-standing human.
  Mitigations: onboarding says "no badge means nothing stood out, not human"; hovering an unbadged author
  opens a card that distinguishes "nothing stood out" from "not enough data"; "Likely human" stays opt-in.

## 4. Countermeasures

Notation follows the scoring spec. Two new independence groups are proposed: `coordination` (evidence
from the thread a post appears in, scoped to that post and never stored) and `timing` (cadence from a
timeline), with group caps 1.5 and 1.2. Thread-scoped evidence changes one contract: the resolver keys
verdicts by handle, so thread features attach to the `PostRef` and merge at render time, and the same
account can read `typical` in one thread and `some` in another; the reason line names the thread. Text
comparisons lowercase the text, strip mentions, URLs, emoji and digits, and compare character 5-gram
shingles by Jaccard similarity: O(n²) over at most a few hundred visible replies.

### 4.1 In-thread coordination (Tier 0 DOM; Tier 1 TweetDetail where noted)

| Feature (group, cap) | Detects | Input and bins | Gate | False-positive risk; caveat copy | v1.1 |
|---|---|---|---|---|---|
| `thread.nearDuplicateReply` (coordination, 1.5) | Template replies across authors; Reddit copied comments | Other authors' *earlier* replies with Jaccard ≥ 0.7: `[0,1)→0` `[1,2)→0.6` `[2,4)→1.0` `[4,∞)→1.5` | Normalised text ≥ 40 chars and ≥ 6 words; the parent's text is never a source | Low with the length gate: copypasta, slogans, "happy birthday" waves. "Popular phrases and memes get repeated by real people." | **Yes** |
| `thread.sharedRareDomain` (coordination, 1.5) | One domain linked by many authors (fox8's strongest tell) | Distinct authors linking the same registrable domain, excluding a built-in top ~1,000 domains and the parent's own domain: `[0,3)→0` `[3,5)→0.8` `[5,∞)→1.2` | Domain resolved (X needs Tier 1 `expanded_url`; the DOM shows t.co) | Low to medium: a thread about one niche site. "People discussing the same story often share the same link." | **Yes** |
| `thread.replyBurst` (timing, 1.2) | Several replies within seconds of the parent | Other authors' replies within 30 s of the parent, when this one is too: `[0,3)→0` `[3,6)→0.4` `[6,∞)→0.8` | Absolute timestamps (`time[datetime]` on X; Reddit's comment timestamp element to confirm) | High: large accounts draw instant replies from notification-on fans. "Popular accounts get many fast replies from people with notifications on." | No; measure |
| `thread.templatePhrase` (content, 0.6) | Generic praise and bait ("Great insight!", "Couldn't agree more", "check my bio") | Bool on a phrase list shipped in the build (the restrict-only policy cannot add phrases) | English only | High and language-biased. | No |
| `thread.joinCohort` (coordination, 1.5) | Repliers with the same join week or handle shape | Other repliers within ±7 days of this account's join date and with the same handle shape: `[0,4)→0` `[4,∞)→0.6` | Tier 1 user objects for ≥ 20 repliers | Very high: sign-up waves after news events and migrations. "Many people joined during the same news event." | No |

### 4.2 Cadence and latency (Tier 1 `UserTweets`/`UserTweetsAndReplies`; Bluesky Tier 2 `getAuthorFeed`; Reddit Tier 2 `comments.json`)

These fire only after the page fetched a timeline (the user opened a profile and scrolled) or, on
Bluesky, on hover. Human inter-post times are bursty and heavy-tailed ([Barabási 2005](https://www.nature.com/articles/nature03459)),
which puts their coefficient of variation above 1; schedulers and uniform-jitter throttles sit below
about 0.6. Accounts verified `org` or `gov` are excluded from the `timing` group.

| Feature (group, cap) | Detects | Input and bins | Gate | False-positive risk; caveat copy | v1.1 |
|---|---|---|---|---|---|
| `x.gapRegularity`, `bsky.gapRegularity`, `reddit.gapRegularity` (timing, 1.0) | Throttled or scheduled posting | Coefficient of variation of the gaps between the latest ≤ 100 posts, gaps over 7 days dropped: `[0,0.5)→1.0` `[0.5,0.8)→0.5` `[0.8,∞)→0` | ≥ 30 gaps spanning ≥ 3 days | Medium: news desks and brands on schedulers. "Accounts that schedule posts with a publishing tool show the same regularity." | **Yes** (X, Bluesky); Reddit after measuring |
| `x.noSleepWindow`, `bsky.noSleepWindow` (timing, 1.0) | Round-the-clock posting | Longest run of empty hours in the circular UTC hour-of-day histogram: `[0,2)→1.0` `[2,4)→0.5` `[4,∞)→0` | ≥ 100 posts over ≥ 7 days (at 50 uniformly random posts about 3 hours are empty by chance) | Medium: team-run and shared accounts, insomniacs. "Shared and team-run accounts post around the clock." | **Yes** |
| `x.minuteMarkShare` (timing, 0.6) | Posting at exact minute marks | Share of posts with seconds = 0: `[0,0.15)→0` `[0.15,0.4)→0.3` `[0.4,∞)→0.6` | ≥ 30 posts | Native-scheduler users; defeated by one line of jitter. | No (brittle) |
| `x.fastReplyShare` (timing, 0.8) | Reply latency after the parent, per account | Share of the account's replies posted < 20 s after their parent: `[0,0.3)→0` `[0.3,0.6)→0.4` `[0.6,∞)→0.8` | ≥ 10 replies with a known parent time (parents arrive in TweetDetail and conversation modules) | Medium to high: notification-on fans; sample hard to reach passively. | No; measure |

### 4.3 Content reuse and LLM tells

| Feature (group, cap) | Detects | Input and bins | Tier | False-positive risk | v1.1 |
|---|---|---|---|---|---|
| `x.selfReuse` (content, 0.8) | Text reuse across the account's own replies | Share of reply pairs with Jaccard ≥ 0.7: `[0,0.1)→0` `[0.1,0.3)→0.4` `[0.3,∞)→0.8` | 1 | Support accounts ("please DM us") and catchphrases; exclude `org`. "Support and campaign accounts reuse wording on purpose." | v1.2 candidate |
| `content.selfRevealPhrase` (content, 1.0) | "As an AI language model", refusal boilerplate | Bool on a short build-time list | 0 | Humans post the phrase ironically; operators filter it in one line. | No |
| `content.markdownArtifacts` (content, 0.4) | Literal `**bold**`, `###`, "Certainly! Here's" where no Markdown renders | Bool | 0 | Developers and copy-paste from notes; brittle. | No |
| `content.parentRestatement` (content, 0.5) | 1:1 restatement of the parent | Share of reply tokens found in the parent ≥ 0.7 | 0 | Quoting to rebut is ordinary, and text detectors already misfire on non-native writers ([Liang et al. 2023](https://arxiv.org/abs/2304.02819)). | No |

### 4.4 Reddit

| Feature (group, cap) | Detects | Input and bins | Tier, cost to us | False-positive risk; caveat copy | v1.1 |
|---|---|---|---|---|---|
| `reddit.karmaSinceFirstActivity` (activity, 1.5) | Aged accounts farmed fast once activated; closes the 180-day gate | `(linkKarma + commentKarma) / days since the oldest visible item`, bins as `reddit.karmaPerDay`; gate: age ≥ 180 d, listing returned < 100 items (so the oldest item is the first), profile not hidden | 2: one `overview.json?limit=100` on hover, cached 24 h | Medium: long-time lurkers who start posting in big subs. "Long-time readers who start posting in large communities can earn karma quickly." | **Yes** |
| `reddit.dormancyGap` (age, 0.6) | "Aged then suddenly active" without a karma spike | `(first visible item − createdAt) / ageDays`: `[0,0.7)→0` `[0.7,0.95)→0.3` `[0.95,1]→0.6` | 2 (same request) | High: Reddit's large lurker population. | Reason line only |
| `reddit.repostTitle` (content, 1.0) | Reposts of the subreddit's top posts | Bool: title Jaccard ≥ 0.9 with one of the subreddit's top 100 all-time posts by another author; gate ≥ 6 words | 2: one `top.json?t=all&limit=100` per subreddit per day | Low to medium: generic titles. "Popular titles get reused by people who never saw the original." | v1.2 (new request type) |
| `reddit.copiedComment` | Copy of an earlier top comment | Same-thread copies are `thread.nearDuplicateReply`; copies from an earlier, reposted thread need that thread's comments | 0 same thread; 2 otherwise | As 4.1. | Same thread **yes** |
| `reddit.farmSubShare` (content, 0.5) | Posting in karma-farm subs (r/FreeKarma4U and similar) | Share of the latest 100 items in a built-in list: `[0,0.2)→0` `[0.2,∞)→0.5` | 2 (same request) | High: newcomers meeting karma minimums do exactly this. | No |
| `reddit.shortCommentKarma` | Karma from one-line comments | Median comment length against comment karma per comment | 2 | High: meme and sports subs are one-liners by design. | No |

### 4.5 X

| Feature (group, cap) | Detects | Input and bins | Tier, cost to us | False-positive risk; caveat copy | v1.1 |
|---|---|---|---|---|---|
| `x.agedRepurposed` (profile, 1.0) | Bought aged accounts, renamed and re-verified | Bool, 1.0: age ≥ 730 d, last username change ≤ 90 d ago, verified-since ≤ 90 d ago | 2: fields of the About lookup Botdar already makes on hover | Low with all three: rebrands that coincide with subscribing. "People often rename and subscribe at the same time after a career change." | **Yes** |
| `x.replyShare` producer | Reply-only timelines | Not new: count `in_reply_to_status_id_str` in Tier 1 `UserTweetsAndReplies` instead of DOM rows | 1 | As in v1. | Yes, as a fix |
| `x.premiumEngagementBait` (content, 0.6) | Premium payout farming after the November 2024 change | Bool: `verified === 'blue'`, reply share ≥ 0.9 and phrase-list hits on ≥ 30% of replies | 1 | High: Premium reply-guys are often humans with a hobby, and it stacks two style signals. | No |
| `x.storeCountryMismatch` (geo, 0.3) | A foreign device behind a local proxy | About "connected via" store region differs from "based in" | 2 | High: travellers, expats, imported phones. | No |

### 4.6 Signals that need a cloud layer

Cross-thread duplicates (the same reply under different posts), co-reply and co-repost clusters,
follow-back rings and join cohorts at scale are where coordination evidence is strongest, and none fits
in one viewer's browser. Each needs the extension to send what the user is reading: handles, post ids or
text fingerprints. Hashing does not protect anyone, because the posts are public and a hash of public
text identifies the thread. That is browsing history under Chrome's Limited Use policy; it ends the
"nothing leaves the browser" promise, adds retention, breach and subpoena exposure, and pooled data is
the line the BrandTotal and Bright Data cases drew (R-02). A server-computed list of coordinated accounts
pushed like the policy file avoids user data, but it is a deny list that makes verdicts stricter, which
the restrict-only policy forbids, and it repeats the pattern that got Bot Sentinel sued. Verdict: not
before a privacy redesign, an explicit opt-in and a legal review.

### 4.7 Ranking

Cost to us: S (Tier 0 or data already captured), M (new parsing or one hover request), L (new request
type or cloud). Cost imposed: what an evading operator gives up.

| Rank | Countermeasure | Cost to us | Cost imposed on the operator |
|---|---|---|---|
| 1 | `thread.nearDuplicateReply` | S | Unique text per account per thread: an LLM call each, and no reuse of proven templates |
| 2 | `x.agedRepurposed` | S | Keep a bought account's handle 90 days before use, or verify long before |
| 3 | `x.noSleepWindow` | S–M | Hours offline every day per account, so more accounts for the same volume |
| 4 | `x.gapRegularity` | S–M | Bursty, human-like schedules that cut throughput |
| 5 | `thread.sharedRareDomain` | S | More domains to register and warm, or fewer authors per link |
| 6 | `reddit.karmaSinceFirstActivity` | M | Farm slowly after activation, or buy pricier accounts with continuous history |
| 7 | `reddit.repostTitle` | M | Reword titles (image matching by moderators still applies) |
| 8 | `x.fastReplyShare`, `thread.replyBurst` | M | Wait before replying, forfeiting the top-reply position farms are paid for |
| 9 | `x.selfReuse` | M | Unique text per reply |
| 10 | Phrase lists, LLM tells, minute marks, join cohorts | S | Almost nothing: a filter or a jitter line |
| 11 | Cloud coordination | L | High, at a privacy cost we do not accept today |

## 5. Cost-raising framing

**Forces human-like behaviour even when evaded.** The timing features are the core. To beat
`x.noSleepWindow` and `x.gapRegularity` an account must go quiet for hours and post in bursts, which caps
its daily output and multiplies the accounts (and the Premium fees, proxies and browser profiles) needed
for the same volume. Reply latency, once validated, taxes the payout business directly, because the money
is in being first. `thread.nearDuplicateReply` forces per-account generation, and LLM paraphrases still
converge in meaning, which a future local embedding model or the cloud layer could catch.
`x.agedRepurposed` and `reddit.karmaSinceFirstActivity` make bought age worth less unless the buyer also
waits, and waiting is the expensive part of age.

**Brittle.** Handle shape, avatar and bio (v1), phrase lists, self-revealing LLM phrases, Markdown
artifacts and minute-mark posting all fall to a one-line change in the operator's pipeline, and the
public repository says which line. Keep such signals out of scoring or at low caps, and never let one
carry a `many` verdict.

**Recommended v1.1 set (six), all local, nothing new leaves the browser:**

1. `thread.nearDuplicateReply` (X, Reddit, Bluesky; Tier 0): the only local coordination signal,
   covering Reddit's same-thread copied comments, with the earliest-author rule against poisoning.
2. `thread.sharedRareDomain` (Tier 0, Tier 1 for X link expansion): fox8's strongest tell; it shares the
   `coordination` cap with (1), so the two cannot stack past 1.5.
3. `x.gapRegularity` with `bsky.gapRegularity`: X data Tier 1 already captures; one sanctioned public
   call on Bluesky.
4. `x.noSleepWindow` with `bsky.noSleepWindow`: the most expensive timing property to fake.
5. `x.agedRepurposed`: reads fields the About lookup already returns; aimed at the aged-account market.
6. `reddit.karmaSinceFirstActivity`: closes the 180-day gate that lets every aged Reddit account skip
   the rate check.

Alongside, as fixes rather than features: produce `x.replyShare` from Tier 1, and set
`x.countryLocaleMismatch` to weight 0 by policy until its input is the account's bio language.

**Must stay out**, because the false-positive cost on real people is too high:

- Generic-praise and engagement-bait phrase lists, LLM tells and parent restatement: they score style,
  English first, and would flag non-native writers who draft with an LLM.
- Join-week cohorts: sign-up waves after news events and migrations (Bluesky in 2024) are human.
- Reply latency and bursts, until calibration shows they separate farms from the notification-on fans of
  large accounts, a group that includes journalists and news desks.
- Minute-mark posting: hits news desks and brands on schedulers, and one jitter line defeats it.
- Karma-farm subreddit participation and short-comment karma: newcomers and meme subs.
- `x.premiumEngagementBait` and `x.storeCountryMismatch`: style and travel, not automation.
- Any cloud signal (4.6).

## 6. Open questions and validation plan

Use the dev-only feature logging from the scoring spec, extended to log thread-scoped evidence in memory
and export it by hand. No accounts are bought, created or operated for testing. "Known automated" means
accounts suspended or labelled by the platform when re-checked 30 and 60 days after logging. Sample sizes
use the rule of three: zero fires on n ordinary accounts bounds the true rate below 3/n at 95%, so 300
ordinary accounts bound it below 1%.

| Signal | What to measure | Sample |
|---|---|---|
| `thread.nearDuplicateReply` | Fire rate on ordinary threads; share of fires on later-suspended accounts; fires on the earliest author of a cluster (must be 0) | 100 threads per platform (50 news and politics, 30 crypto or celebrity, 20 ordinary); hand-review 300 fires |
| `thread.sharedRareDomain` | Fires per thread; which domains the allowlist misses | The same threads; review every fire |
| `x.gapRegularity`, `x.noSleepWindow`, Bluesky twins | Distribution on ordinary accounts with ≥ 100 posts; overlap with schedulers and news desks | 300 ordinary profiles per platform; 100 journalists and 30 news desks on X, none of which may reach `many` through these features |
| `x.agedRepurposed` | Base rate of rename-and-verify on old accounts; field availability | 300 About lookups during normal browsing |
| `reddit.karmaSinceFirstActivity` | Distribution for accounts ≥ 180 d old; how often the < 100-item gate is met; lurker false positives | 300 hovered accounts, 100 of them in large default subs |
| Non-English accounts | Whether any new feature fires at a different rate by language | 100 accounts across at least 5 languages |
| `x.fastReplyShare`, `thread.replyBurst` | Whether fast repliers under accounts with > 1M followers are later suspended more often than slow ones | 50 threads under large accounts, about 1,000 replies |
| Poisoning | Replay a recorded thread with injected copies of an earlier reply; the original author's tier must not change | 20 unit fixtures |

Acceptance for each feature: it fires on under 2% of the ordinary sample, at least half of its
hand-reviewed fires are defensible, and it does not lift the share of `many` verdicts above the 5%
target. A feature that misses ships with weight 0 and stays in the build, so the restrict-only policy
never has to enable it later.

Calibration cadence: rerun this pass every release, and revisit this document every six months or when
a platform changes default handles, payout rules or the About panel, since operators adapt to whatever
ships.

Open questions:

- Does `AboutAccountQuery` carry "verified since" and the last rename date, or only the rendered dialog?
  `x.agedRepurposed` depends on it.
- How many timeline posts does the X web client fetch before a user stops scrolling, and is the 100-post
  gate met often enough for `x.noSleepWindow` to matter?
- Do Reddit comment timestamps in the DOM carry seconds, as latency needs?
- Can a small local sentence-embedding model catch paraphrased templates within the extension's memory
  and package-size budget?

## Sources

[Outlook India](https://www.outlookindia.com/amp/story/xhub/featured-insights/5-best-places-to-buy-reddit-accounts-in-2026-ranked-by-account-quality) ·
[Pixelscan](https://pixelscan.net/blog/buy-aged-reddit-accounts/) ·
[handles.gg](https://handles.gg/buy-twitter-usernames) ·
[Socialz](https://socialz.ai/blog/buy-twitter-subscribers) ·
[DataImpulse](https://dataimpulse.com/blog/residential-proxy-pricing-comparison/) ·
[Databay](https://databay.com/blog/how-much-do-residential-proxies-cost) ·
[send.win](https://blog.send.win/7-cheapest-antidetect-browsers-that-actually-work-in-2026/) ·
[ScrapingBee](https://www.scrapingbee.com/blog/anti-detect-browser/) ·
[tech.co](https://tech.co/news/x-premium-price-increase-grok-3) ·
[ReplyGuyX](https://chromewebstore.google.com/detail/fbnofdcpepbicbjeillhnhbdleaeinbh) ·
[Reply Guy](https://builditn0w.gumroad.com/l/twitter-x-reply-guy) ·
[Scroll.in](https://scroll.in/article/1072706/there-is-a-reason-your-x-feed-has-turned-more-toxic-have-you-heard-of-engagement-farming) ·
[WION](https://www.wionews.com/technology/x-removed-over-1-7-million-bots-dm-spam-next-says-product-head-nikita-bier-1760344720045/amp) ·
[Digital Today](https://www.digitaltoday.co.kr/cn/view/45611/x-head-of-product-says-80-percent-of-crypto-activity-may-be-bots-spam-not-solvable-by-technology-alone) ·
[OpenAI STORM-2035](https://openai.com/index/disrupting-malicious-uses-of-ai-storm-2035-2025) ·
[Bluesky 2025 transparency report](https://bsky.social/about/blog/01-29-2026-transparency-report-overview) ·
[fox8](https://ar5iv.labs.arxiv.org/html/2307.16336) ·
[AI-generated profile faces](https://arxiv.org/pdf/2401.02627) ·
[Barabási 2005](https://www.nature.com/articles/nature03459) ·
[Liang et al. 2023](https://arxiv.org/abs/2304.02819) ·
[The Motte](https://www.themotte.org/post/328/smallscale-question-sunday-for-january-22/57048) ·
[Lemmy](https://lemmy.linuxuserspace.show/comment/1934760) ·
[Repost Sleuth](https://www.patreon.com/repostsleuthbot/home) ·
[TechCrunch on Reddit profile hiding](https://techcrunch.com/2025/06/03/reddit-now-lets-you-hide-content-like-posts-and-comments-from-your-user-profile/).
Background: [research/heuristics.md](research/heuristics.md), [research/feasibility.md](research/feasibility.md).
