# Scoring specification

How Botdar turns the signals it can see about an account into a tier, a set of reasons and a confidence.
Architecture, sources and the policy system are in [architecture.md](architecture.md).

## Purpose and non-goals

**Purpose.** Give a reader a quick, honest, explainable read on whether an account shows patterns common
in automated accounts, using only signals visible to the browser, with every number adjustable through
the signed policy file.

**Non-goals.**
- Not a classifier with a claimed accuracy. The literature shows metadata models transfer poorly across
  populations and time, so v1 ships hand-set weights and collects feedback to calibrate later.
- Not a probability shown to users. The internal probability drives bucketing only.
- Not a judgement of intent. Automated is not malicious; declared automation is a separate, neutral state.
- Not a text or AI-writing detector.

## Configuration structure

All numbers live in `src/core/scoring/weights.default.json` and can be lowered or adjusted by the policy
file (see "Policy override semantics").

```jsonc
{
  "schema": 1,
  "platforms": {
    "<platform>": {
      "prior": -2.5,                               // log-odds before any evidence
      "thresholds": { "some": 0.30, "many": 0.60 }, // on probability
      "groupCaps": { "handle": 1.2, "profile": 1.2 },
      "confidenceWeights": { "0": 0.25, "1": 0.55, "2": 0.20 },
      "features": {
        "<feature id>": {
          "group": "activity",                     // independence group
          "cap": 2.0,                              // |contribution| never exceeds this
          "kind": "bins",                          // or "bool"
          "bins": [[0, 10, 0], [10, 30, 0.4], [30, null, 2.0]]
        },
        "<bool feature>": { "group": "handle", "cap": 0.7, "kind": "bool", "weight": 0.7 }
      }
    }
  }
}
```

- `prior`: log-odds of the "many signals" hypothesis with no evidence. `-2.5` ≈ 7.6 %.
- `thresholds`: probability cut-offs for the `some` and `many` tiers.
- `groupCaps`: optional cap on the summed positive contributions of a whole independence group, so three
  weak handle features cannot stack into a strong one.
- `confidenceWeights`: how much each source tier contributes to confidence when it delivered data for the
  account (see step 6). They need not sum to 1; confidence is normalised.
- Feature `kind`:
  - `bins`: `[lo, hi, logOdds]` triples, half-open `[lo, hi)`, `null` = unbounded. The first matching bin
    wins. A value matching no bin contributes 0.
  - `bool`: contributes `weight` when true, 0 when false.
- `group`: one of `age`, `activity`, `graph`, `handle`, `profile`, `verification`, `content`, `geo`,
  `timing`, `coordination`.

## Default feature tables

All values are uncalibrated starting points chosen from the directions and rough magnitudes in the
literature (BotometerLite feature importances, Cresci 2015, Akyon & Kalfaoglu for Instagram-style
follow ratios). They will move after the calibration pass.

### X

| Feature | Group | Cap | Input | Bins / weight | Gate |
|---|---|---|---|---|---|
| `x.postsPerDay` | activity | 2.0 | `postCount / max(ageDays, 1)` | `[0,10)→0` `[10,30)→0.4` `[30,75)→1.0` `[75,150)→1.5` `[150,∞)→2.0` | `createdAt` and `postCount` known |
| `x.accountAgeDays` | age | 1.5 | days since `createdAt` | `[0,30)→1.5` `[30,90)→0.8` `[90,365)→0.2` `[365,∞)→-0.5` | `createdAt` known |
| `x.followingRatio` | graph | 1.5 | `following / (followers + 1)` | `[0,1)→-0.3` `[1,5)→0` `[5,20)→0.6` `[20,100)→1.0` `[100,∞)→1.5` | `following ≥ 100` |
| `x.handleNameDigits` | handle | 0.7 | handle matches `^[a-z]+\d{5,}$` | bool, 0.7 | always |
| `x.handleTrailingDigits` | handle | 0.5 | count of trailing digits | `[0,5)→0` `[5,∞)→0.5` | always |
| `x.handleBigramLL` | handle | 0.8 | mean log character-bigram likelihood of the handle's letters | `(-∞,-3.8)→0.8` `[-3.8,-3.4)→0.4` `[-3.4,∞)→0` | handle has ≥ 4 letters |
| `x.defaultAvatarEmptyBio` | profile | 1.0 | 0, 1 or 2 of {default avatar, empty bio} | `[0,1)→0` `[1,2)→0.3` `[2,3)→1.0` | both fields known |
| `x.newAndBlue` | verification | 0.8 | `verified === 'blue'` and age < 90 d | bool, 0.8 | both known |
| `x.replyShare` | content | 0.8 | `replyShare.ratio` | `[0,0.9)→0` `[0.9,∞)→0.8` | `replyShare.sampleSize ≥ 20`, counted over the owner's tweets in the Tier 1 `UserTweetsAndReplies` bodies |
| `x.usernameChanges` | profile | 0.6 | count from About | `[0,3)→0` `[3,∞)→0.6` | Tier 2 delivered |
| `x.countryLocaleMismatch` | geo | 0.4 | About country is not among the plausible regions of the language detected in the account's bio plus the post text Tier 1 carries for it (`src/core/text/`) | bool, 0.4 | About country known and resolved to a code; a language detected (≥ 12 words, confidence ≥ 0.5) that has a region table; never English. Weak and error-prone (VPNs, travel, second-language writers) |
| `x.gapRegularity` | timing | 1.0 | coefficient of variation of the gaps between the newest ≤ 100 `postTimestamps`, gaps over 7 days dropped | `[0,0.5)→1.0` `[0.5,0.8)→0.5` `[0.8,∞)→0` | ≥ 30 gaps spanning ≥ 3 days; not verified `org` or `gov`, not declared automated. Post times come from Tier 1 `UserTweets` only (the posts tab of a profile visit), owned by the user the request names |
| `x.noSleepWindow` | timing | 1.0 | longest run of empty hours in the circular UTC hour-of-day histogram of the newest ≤ 100 posts | `[0,2)→1.0` `[2,4)→0.5` `[4,∞)→0` | ≥ 100 posts over ≥ 7 days; not verified `org` or `gov`, not declared automated |

Group caps: `handle` 1.2, `profile` 1.2, `geo` 0.4, `timing` 1.5, `coordination` 1.5. Prior `-2.5`. Confidence weights `{0: 0.25, 1: 0.55, 2: 0.20}`.

### Reddit

| Feature | Group | Cap | Input | Bins / weight | Gate |
|---|---|---|---|---|---|
| `reddit.karmaPerDay` | activity | 1.5 | `(linkKarma + commentKarma) / max(ageDays, 1)` | `[0,50)→0` `[50,200)→0.6` `[200,1000)→1.0` `[1000,∞)→1.5` | `ageDays < 180` |
| `reddit.karmaSinceFirstActivity` | activity | 1.0 | `(linkKarma + commentKarma) / days since the oldest visible item` | `[0,50)→0` `[50,200)→0.4` `[200,1000)→0.7` `[1000,∞)→1.0` | `ageDays ≥ 180` (the complement of `reddit.karmaPerDay`, so the two never both fire), the overview listing returned 1 to 99 items (its oldest item is the first and the profile shows something), the oldest item at least 7 days old. Tier 2 only: one `overview.json?limit=100` on hover |
| `reddit.accountAgeDays` | age | 1.2 | days since `createdAt` | `[0,30)→1.2` `[30,180)→0.6` `[180,730)→0` `[730,∞)→-0.6` | `createdAt` known |
| `reddit.postToCommentKarma` | content | 1.0 | `linkKarma / (commentKarma + 1)` | `[0,5)→0` `[5,20)→0.5` `[20,∞)→1.0` | `linkKarma ≥ 500` |
| `reddit.generatedName` | handle | 0.4 | matches `^[A-Z][a-z]+[-_][A-Z][a-z]+[-_]?\d{1,4}$` | bool, 0.4 | always; many humans keep it, so low weight |
| `reddit.noAvatar` | profile | 0.3 | default snoo avatar | bool, 0.3 | Tier 2 delivered |
| `reddit.noVerifiedEmail` | profile | 0.3 | `has_verified_email === false` | bool, 0.3 | field present for other users (day-one check; drop otherwise) |

Prior `-2.8`. Confidence weights `{0: 0.30, 1: 0.0, 2: 0.70}` (Reddit has no Tier 1). Group cap
`coordination` 1.5.

### Bluesky (proposed)

Mirrors the X numbers where the signal is the same. All uncalibrated.

| Feature | Group | Cap | Input | Bins / weight | Gate |
|---|---|---|---|---|---|
| `bsky.postsPerDay` | activity | 2.0 | `postsCount / max(ageDays, 1)` | same bins as `x.postsPerDay` | Tier 2 delivered and `createdAt` known |
| `bsky.accountAgeDays` | age | 1.5 | days since `createdAt` | same bins as `x.accountAgeDays` | `createdAt` known (Tier 1 provides it) |
| `bsky.followsRatio` | graph | 1.5 | `followsCount / (followersCount + 1)` | same bins as `x.followingRatio` | `followsCount ≥ 100` |
| `bsky.handleDigitsOnBskySocial` | handle | 0.7 | handle ends in `.bsky.social` and local part matches `^[a-z]+\d{4,}$` | bool, 0.7 | always; custom-domain handles never fire |
| `bsky.noAvatarEmptyBio` | profile | 1.0 | 0, 1 or 2 of {no avatar, empty description} | same bins as `x.defaultAvatarEmptyBio` | both known |
| `bsky.declaredBot` | — | — | `labels[]` contains `val === 'bot'` with `src === did` | override → `declared` | always |
| `bsky.gapRegularity` | timing | 1.0 | as `x.gapRegularity` | same bins as `x.gapRegularity` | as `x.gapRegularity`. Post times (AppView `indexedAt`, else the record's `createdAt`) from the Posts tab only (`filter=posts_and_author_threads`): Tier 1 page bodies with that filter, and the Tier 2 public `getAuthorFeed` on hover, whose set replaces Tier 1's |
| `bsky.noSleepWindow` | timing | 1.0 | as `x.noSleepWindow` | same bins as `x.noSleepWindow` | as `x.noSleepWindow` |

Prior `-2.5`. Confidence weights `{0: 0.20, 1: 0.40, 2: 0.40}`. Group caps `handle` 1.2, `profile` 1.2,
`timing` 1.5, `coordination` 1.5.

### Hacker News

Mirrors the Reddit numbers where the signal is the same, and weighs less where Hacker News makes it
weaker ([ADR-0026](decisions/ADR-0026-hacker-news-adapter.md)). Every account input comes from the Firebase
`user/<id>.json` lookup: the page renders a username and nothing else, and Hacker News has no avatars,
no follower graph and no suggested usernames. All uncalibrated.

| Feature | Group | Cap | Input | Bins / weight | Gate |
|---|---|---|---|---|---|
| `hn.accountAgeDays` | age | 1.2 | days since `created` | same bins as `reddit.accountAgeDays` | `created` known |
| `hn.karmaPerDay` | activity | 0.8 | `max(karma, 0) / max(ageDays, 1)` | `[0,50)→0` `[50,200)→0.3` `[200,1000)→0.5` `[1000,∞)→0.8` | `ageDays < 180` |
| `hn.submissionsPerDay` | activity | 1.2 | `submitted.length / max(ageDays, 1)` | `[0,10)→0` `[10,25)→0.4` `[25,50)→0.8` `[50,∞)→1.2` | `submitted.length ≥ 10` |
| `hn.hasAbout` | profile | 0.3 | the `about` field is non-empty | bool, −0.3 | Tier 2 delivered |
| Declared (username, about) | — | — | a username whose last word is "bot", or a first-person "I am a … bot" in `about` | override → `declared` | always |

Prior `-2.8`. Confidence weights `{0: 0.30, 1: 0.0, 2: 0.70}` (Hacker News has no Tier 1). Group cap
`coordination` 1.5.
The green name Hacker News gives new accounts is not read until a recording shows one, and `[dead]` and
`[flagged]` are moderation outcomes, not evidence about the account, so neither is a feature.

### Every platform

One feature reads the thread on the page rather than the account
([ADR-0027](decisions/ADR-0027-near-duplicate-reply.md)). It sits in every platform's table with the
same numbers and a `coordination` group cap of 1.5, which the planned `thread.sharedRareDomain` will
share.

| Feature | Group | Cap | Input | Bins / weight | Gate |
|---|---|---|---|---|---|
| `thread.nearDuplicateReply` | coordination | 1.5 | distinct other authors with an earlier reply in the same thread whose word set has Jaccard similarity ≥ 0.7 with this account's reply; the most over the account's replies on the page (`src/core/thread/`) | `[0,1)→0` `[1,2)→0.6` `[2,4)→1.0` `[4,∞)→1.5` | the account has a reply on the page whose normalised text is ≥ 40 characters and ≥ 6 words. A thread is a post page (X, Bluesky), a Reddit post's comments, a Hacker News `item` page; the root post, its ancestors, a reply's own parent, X's promoted posts and the posts X appends below the conversation are never sources, and quoted text is left out. Tier 0 |

### Gating rules

A feature is simply omitted from `toFeatures()` when its gate is not met. An omitted feature contributes
nothing and is not listed as evidence. Gates exist so that a ratio over tiny counts, or a rate over a
one-day-old account, cannot dominate.

## Why each feature is a signal

The tables above say what each feature measures and how much it weighs. This section says why it
measures anything at all, so that a reader can judge a bin or propose a feature without rereading the
research, and so that the hover card's why clauses ("Reason templates and caveats") have a rationale to
track. Each entry gives the mechanism (what running accounts at scale does that a person does not),
the evidence (from [research/heuristics.md](research/heuristics.md) and
[research/reddit-bot-prevalence.md](research/reddit-bot-prevalence.md)), and the honest counter-case,
which is also what the hover-card caveat tells the user. The recurring theme: every feature is a trace
of **effort that was not spent per account**. Operators optimise for volume across many accounts, so
anything that costs per-account time, money or patience is skipped, and the skip is visible.

### Activity rate (`x.postsPerDay`, `bsky.postsPerDay`, `reddit.karmaPerDay`, `reddit.karmaSinceFirstActivity`, `hn.submissionsPerDay`, `hn.karmaPerDay`)

- **Mechanism.** Software does not sleep, work or tire, and an operator's return scales with output
  per account, so automated accounts post at rates a person cannot sustain. Dividing by account age
  matters: a day-old account with 300 posts and a five-year account with 300 posts are opposite cases,
  and the rate separates them where the raw count cannot.
- **Evidence.** Posting frequency over account age (`tweet_freq`) is the strongest single derived
  feature in BotometerLite and the top-ranked metadata signal in the literature review. On Reddit the
  documented farming pattern is fast karma on a young account (reposts to clear subreddit karma
  minimums, then resale), hence the `ageDays < 180` gate: on an old account years of ordinary use
  dilute the rate until it says nothing.
- **Counter-case.** Newsrooms, brands, live-tweeters and a few compulsive humans post at these rates,
  which is why the cap is 2.0 and not enough on its own to reach `many`.
- **On Reddit, past the gate.** The 180-day gate is also the evasion: an aged account is never
  rate-checked. `reddit.karmaSinceFirstActivity` divides the same karma by the days since the oldest
  item in the user's public overview, which is the account's first visible activity when the listing
  is shorter than one 100-item page (a longer one hides it, so the feature is omitted). It takes the
  other side of the age line, so it never stacks with `reddit.karmaPerDay`. It weighs less (cap 1.0)
  and needs a span of at least a week: Reddit keeps karma after the posts that earned it are deleted,
  so an account that wiped its history and posted a few comments lately shows its whole karma over a
  few days, which the data cannot tell from farming. Counter-cases: that, and long-time readers who
  start posting in large communities and earn karma quickly. It is fetched on hover only and kept for a day
  ([ADR-0028](decisions/ADR-0028-reddit-karma-since-first-activity.md)).
- **On Hacker News.** `submitted` counts stories and comments together, and the site throttles new
  accounts that post fast, so ten a day sustained is already rare for a person; the bins start there
  and stop at 1.2. Karma is weaker than on Reddit: one Show HN that reaches the front page earns a
  new account hundreds of points in a day, and launching a project is a common reason to sign up. The
  karma rate therefore keeps Reddit's bin edges at about half the weight (cap 0.8), so a launch plus a
  join date stays below `some`.

### Account age (`x.accountAgeDays`, `reddit.accountAgeDays`, `bsky.accountAgeDays`, `hn.accountAgeDays`)

- **Mechanism.** Automated accounts get banned and are replaced, so a fleet skews young at any moment.
  Aged accounts exist but cost money on the resale market, so the cheap end of automation is new. The
  negative bins are the mirror image: surviving years of platform enforcement is evidence of a person,
  and an old account also makes the rate features above trustworthy.
- **Evidence.** 70% of the 944 IRA accounts Reddit banned had zero karma, which is the profile of
  accounts created and barely used; join-date clustering is a standard coordinated-campaign tell;
  account age is in every metadata feature set reviewed.
- **Counter-case.** Every account was new once. A recent join date therefore never carries enough
  weight to cross a threshold without a second group.

### Following ratio (`x.followingRatio`, `bsky.followsRatio`)

- **Mechanism.** Following is the one social action an account can take unilaterally; being followed
  needs someone else's choice. Mass-following is the cheapest growth tactic there is (follow thousands,
  hope for follow-backs), so following far above followers reads as a lot of outreach that nobody
  reciprocated. The `following ≥ 100` gate stops the ratio being decided by a handful of follows, and
  the negative bin rewards the reverse: more followers than follows means other people opted in.
- **Evidence.** BotometerLite's SHAP analysis: high friends (following) count and friends growth push
  toward bot; a high followers/friends ratio pushes toward human. Akyon & Kalfaoglu's Instagram fakes
  (one at 3,949 following, 15 followers) show the same shape on another platform.
- **Counter-case.** New users who follow widely before anyone follows back, and lurkers who never post.

### Handle shape (`x.handleNameDigits`, `x.handleTrailingDigits`, `x.handleBigramLL`, `bsky.handleDigitsOnBskySocial`, `reddit.generatedName`)

- **Mechanism.** Creating accounts in bulk means naming them in bulk. Either the platform's suggested
  handle is accepted as-is (name plus digits on X and `bsky.social`, `Adjective_Noun_1234` on Reddit)
  or a script generates strings, and generated strings pair letters in ways no language does, which is
  what a low character-bigram likelihood detects. A person choosing their own handle spends a small
  amount of identity on it; a script spends none.
- **Evidence.** Digits in the screen name and `screen_name_likelihood` (bigram geometric mean over 2M
  handles) are BotometerLite features, and long screen names push toward bot in its SHAP analysis. The
  busiest TikTok accounts in a 2025 study all carried the default `user` plus nine digits.
- **Counter-case.** Many people accept the suggested handle and never change it, so these features
  share one group cap of 1.2 (they all measure the same decision) and `reddit.generatedName` alone is
  worth 0.4. A Bluesky custom-domain handle never fires because setting one is itself an investment.

### Profile completeness (`x.defaultAvatarEmptyBio`, `bsky.noAvatarEmptyBio`, `reddit.noAvatar`, `reddit.noVerifiedEmail`, `hn.hasAbout`)

- **Mechanism.** A photo and a bio cost per-account effort, so a fleet skips them unless it is building
  a persona. Both missing weighs far more than one missing because the pair is the fleet default,
  whereas one blank field is ordinary for humans. An unverified email is the same story: verifying
  every account in a fleet needs a mailbox per account.
- **Evidence.** `default_profile`, `description_length`, `has_profile_image` and `has_profile_url`
  appear in BotometerLite and BotArtist; "no profile picture" is a top Instagram fake-account feature.
- **Counter-case.** Privacy-minded people leave profiles blank on purpose. The group cap (1.2) and the
  low Reddit weights keep this from deciding anything alone.
- **On Hacker News.** The profile is a single free-text `about` field, and most people never fill it
  in (22 of the 25 thread authors checked on 2026-10-27 had none), so an empty one is the norm and
  weighs nothing. Only a filled one counts, towards ordinary, as effort spent on this one account.

### Verification timing (`x.newAndBlue`)

- **Mechanism.** Paid verification ranks replies higher. An operator buys it on fresh accounts so that
  reply spam is seen, so the signal is not the badge but the timing: an account that paid for reach
  before it had anything to say. (Legacy verification pointed the other way, toward human, which is why
  the plain `verified` flag is not a feature.)
- **Evidence.** Platform statements and reporting on reply spam and engagement farming after paid
  verification; weak and recent, hence 0.8 and a 90-day window.
- **Counter-case.** Anyone can pay on day one, and some people do.

### Reply share (`x.replyShare`)

- **Mechanism.** Reply bots exist to insert themselves into other people's threads (promotion,
  engagement farming, LLM reply bots), so their timeline is almost entirely replies; original posts
  need something to say. The `sampleSize ≥ 20` gate stops a handful of visible posts from firing it. The share is the
  owner's tweets with a non-empty `legacy.in_reply_to_status_id_str` over all the owner's tweets in the
  replies tab (`UserTweetsAndReplies`, Tier 1, passive), which arrives a page at a time and is tallied
  across pages by tweet id. The owner is the user the request names; without one nothing is counted. A
  repost counts as a post and never as a reply, nor does a post answering its own author (a thread
  continuation), and the posts tab is not read, since it holds no replies. The field names are guesses
  until a recording confirms them.
- **Evidence.** Practitioner lists and platform statements on reply spam; no peer-reviewed metadata
  study, hence a modest 0.8.
- **Counter-case.** Some people only ever reply. That is a style, and the caveat says so.

### Username changes (`x.usernameChanges`)

- **Mechanism.** Aged accounts that are bought or repurposed are renamed for each new campaign, and X's
  "About this account" exposes the count. Three or more renames means the identity has been swapped,
  not corrected.
- **Evidence.** A single unverified report; weighted 0.6 until the calibration pass says more.
- **Counter-case.** People rebrand, marry, or fix a typo. Once or twice is free.

### Country mismatch (`x.countryLocaleMismatch`)

- **Mechanism.** Influence operations run personas in another country's politics, and the platform's
  IP-inferred country can contradict the persona's language. The input is the account's own text: a
  bundled detector (`src/core/text/language.ts`; script first, then stopword profiles for 23
  Latin and Cyrillic languages) reads the bio and the post text Tier 1 kept (a repost's text is the
  reposted author's and is not kept), and the About country, resolved to an ISO code from its
  printed name, is compared with the regions where that language is official or widely spoken
  (`languageRegions.ts`). A global language lists every country where it is official, so French in
  Senegal never fires. English never compares at all: it is the lingua franca of the platforms,
  written everywhere, so "Based in Germany, writes in English" says nothing. A short bio, an even
  mix, a language read at under 0.5 confidence or an unreadable country omits the feature. The
  feature carries the language it compared, so the reason line does not detect it again. The
  viewer's locale only helps read the country's name.
- **Evidence.** None measured for this feature yet; the persona-from-abroad pattern is what the About
  panel's country exposes. Hence 0.4 under a `geo` cap of 0.4, which can never decide a tier alone.
- **Counter-case.** Expatriates, travellers, VPN users and people who write in a second language
  other than English; the platform's inference is also often wrong.

### Posting cadence (`x.gapRegularity`, `bsky.gapRegularity`, `x.noSleepWindow`, `bsky.noSleepWindow`)

- **Mechanism.** People post in bursts and sleep. The gaps between a person's posts are heavy-tailed
  (a few minutes inside a burst, hours between them), so their standard deviation exceeds their mean,
  and a person's day has a run of hours with no posts at all. A scheduler or a throttled script posts
  on a clock, so its gaps barely vary, and software does not sleep, so it fills every hour. Unlike
  every v1 feature this is behaviour, not an account attribute: to beat it an operator has to go quiet
  for hours a day and post in bursts, which caps output per account and multiplies the accounts
  needed (adversarial-evasion.md 5). The statistics are in `src/core/scoring/cadence.ts`.
- **Evidence.** Human inter-event times are bursty with a coefficient of variation above 1 (Barabási
  2005); uniform-jitter throttles sit below about 0.6. At 50 uniformly random posts about three hours
  stay empty by chance, hence the 100-post gate for the sleep window. No measurement on Botdar's own
  sample yet; the two share a `timing` cap of 1.5, and as one group they can never meet the two-group
  rule for `many` on their own.
- **Counter-case.** Newsrooms, brands and anyone who schedules posts with a publishing tool show the
  same regularity; shared and team-run accounts, and some insomniacs, post around the clock. Accounts
  verified as an organisation or a government are left out of timing for that reason, and so are
  accounts that declared themselves automated, whose verdict the declaration already decided.
  Post times are normalised once, in the pipeline: no time more than ten minutes in the future
  (Bluesky's client-written `createdAt` can say 2099), distinct, the newest 100.

### Near-duplicate replies (`thread.nearDuplicateReply`)

- **Mechanism.** A reply operation posts the same template from many accounts into the threads it
  targets, because writing a reply per account costs a person's time or an LLM call each, and a
  template that already got engagement is worth reusing. A person writes their own words. So several
  accounts posting near copies of one reply in one thread is coordination, the one pattern no single
  account's profile shows. Only *earlier* copies count, so the first author of a text always scores 0:
  copying a real person's reply flags the copier, never the person.
- **Evidence.** Coordinated-inauthentic-behaviour takedowns and the fox8 botnet (Yang and Menczer
  2023) show reply farms sharing text and links across accounts; Reddit's copied-comment bots repost
  an earlier comment from the same thread (adversarial-evasion.md 4.1). Text is compared as sets of words after removing case, URLs,
  mentions, punctuation and emoji, so a swapped word or an added hashtag still matches and two
  different replies of six words or more rarely do. No measurement on Botdar's own sample yet
  (adversarial-evasion.md 6).
- **Counter-case.** Popular phrases, slogans and memes get repeated by real people, and a thread of
  fans can repeat one line. The length gate drops greetings and one-liners; the `coordination` cap of
  1.5 keeps this feature alone below `some` (prior −2.5 + 1.5 gives p ≈ 0.27); and as one group it can
  never meet the two-group rule for `many` on its own. On Bluesky the order comes from the record key,
  which the author's client writes, so a backdated copy can make an original look later
  ([ADR-0027](decisions/ADR-0027-near-duplicate-reply.md)).

### Reddit karma shape (`reddit.postToCommentKarma`)

- **Mechanism.** Karma farming reposts content that already did well; a repost earns post karma without
  any conversation, while comment karma needs reading and replying. Post karma far above comment karma,
  on an account with real post karma (`linkKarma ≥ 500`), is the farming footprint.
- **Evidence.** Community wikis on karma farming and aged-account resale; Repost Sleuth's volume
  (claimed 1M+ searches a day) shows how common reposting is.
- **Counter-case.** Photographers, artists and anyone who posts original content and rarely comments.

### Declared automation (platform label, flair, username, bio)

- **Mechanism.** Reddit's bot etiquette and X's automation rules ask bots to disclose, and the ones that
  comply are the benign end of automation. A disclosure is the account telling us directly, so it
  overrides scoring instead of feeding it: no inference is needed and none should be drawn. Reading
  flair, a username whose last word is "bot", and an "I am a bot" bio exists because the first live
  test found a subreddit of long-lived GPT-2 bots whose metadata looked typical while their flair said
  what they were.
- **Evidence.** Reddit's APP tag and X's Automated label are platform-attested. "Bottiquette"
  compliance was a top feature in the Polish-Reddit detection paper.
- **Counter-case.** A person can put "bot" in a name or flair as a joke; the badge copy for this tier is
  neutral for that reason, and the bio match requires a first-person declaration, not the word alone.

### Why the pieces combine the way they do

- **The prior** (`-2.5` on X, `-2.8` on Reddit and Hacker News) encodes the base rate: most accounts are people, so an
  account starts well below the thresholds and has to earn its way up.
- **Independence groups** exist because features inside a group measure one decision (how the account
  was named, whether the profile was filled in), so two of them are one piece of evidence, not two.
  Cheap automation trips several groups at once; a person usually trips one. That is why `many` needs
  evidence from two distinct groups, and why group caps bound the handle and profile features.
- **Negative bins** (old account, more followers than follows) are deliberate: the engine is asked to
  explain a Likely human read with reasons, so it needs features that pull the score down, not only a
  low prior.
- **Confidence** drops when a tier that would normally deliver data did not, because the features that
  were never computed might have pulled either way. The badge goes hollow when confidence is low, and
  an account with nothing to read at all gets a No read badge ("Checking" while its lookup runs)
  rather than no badge, so the reader can tell it was analysed and the result was unclear, not skipped.

## Engine algorithm

Input: `Feature[]` from the platform adapter, the effective platform config, and the signals' `tiersDelivered`.

1. **Declared override.** If `signals.declaredAutomated` is true, return tier `declared`, confidence 1,
   no scoring. The one reason names what declared it (`signals.declaredBy`): the platform's own label
   ("Carries the platform's own automated-account label"), or a self-description the account cannot
   have made by accident, read by `src/core/handle/selfDescription.ts`: a username whose last word is
   "bot" or the AutoModerator account ("Its username describes the account as automated"), an author
   flair whose last word is "bot" such as "Verified GPT-2 Bot" ("Its flair describes the account as
   automated"), or a bio that says "I am a bot" / "this account is a bot" in so many words ("Its bio
   describes the account as automated"). The matches are deliberately strict: Talbot, BotHunter,
   "Bot Developer" flair and "bot hunter" bios never count, because a false declaration is the worst
   label the extension can print. Added 2026-10-25 after a manual test on a subreddit of flaired GPT-2
   bots that metadata alone scored as typical.
2. **Empty.** If there are no features, return tier `unknown`, confidence 0.
3. **Contributions.** For each feature, `raw = lookup(spec, value)` (bin value or bool weight), then
   `contribution = clamp(raw, -cap, +cap)`.
4. **Group caps.** For each group with a `groupCap`, sum its positive contributions; if the sum exceeds
   the cap, scale those positive contributions down proportionally so the sum equals the cap. Negative
   contributions are left alone.
5. **Logistic.** `logOdds = prior + Σ contributions`; `p = 1 / (1 + e^(-logOdds))`.
6. **Confidence.** Let `delivered` be `signals.tiersDelivered`, the tiers that delivered data for this account. The
   resolver tracks it per account (Tier 0 when the page was read, Tier 1 when a relayed response was
   absorbed, Tier 2 when a lookup or cache hit returned data; a tier that returned nothing is not
   delivered). It is not inferred from `provenance`, because a higher tier overwriting every field a
   lower tier supplied would otherwise erase the lower tier from the count.
      `confidence = Σ confidenceWeights[t] for t in delivered / Σ confidenceWeights[all]`. Conservative mode
   therefore reads as lower confidence by design.
7. **Bucketing.**
   - `many` requires all of: `p ≥ thresholds.many`; at least two evidence items with
     `contribution ≥ 0.6` from **distinct** groups (the independence rule); `confidence ≥ 0.5`.
   - Otherwise `some` if `p ≥ thresholds.some`.
   - Otherwise `typical`.
   - **Likely human is earned.** A `typical` result stays `typical` only when `confidence ≥ 0.5`
     and at least two worded evidence items lie outside the `handle` group; otherwise it becomes
     `unknown`, shaped as in step 2 (badge "No read"). An item is worded when its template has
     something to say (step 9); an absent pattern such as "not verified early" is silent and does not
     count, so a Likely human card always lists at least two reasons. Nor does an item that points
     towards automation (`contribution > 0`, such as "Joined 6 weeks ago" or "Default avatar"): a
     young account with a default avatar can stay under `thresholds.some` and must not get a card
     that says it looks ordinary. Neutral items (`contribution = 0`, such as "Custom avatar") count,
     since most ordinary observations sit in a zero bin, unless the feature has no ordinary reading
     (a country mismatch a policy weighs at 0): the card shows such an item pointing towards automated,
     so it cannot vouch for the account (ADR-0022). The rule, the card's arrow and the Likely human
     counter-case share one test, `isOrdinaryEvidence` in `src/core/scoring/reasons.ts`. With little data the low prior
     alone lands an account in `typical`: on Reddit's page an obvious self-declared bot scored
     `typical` from one non-signal (a username outside the suggested pattern). On Reddit the
     confidence bar means a Tier 2 lookup delivered. Every adapter scores the handle's shape from the
     name on the post, so handle evidence never counts towards the two. `some`, `many` and `declared`
     are unaffected, so no flagged read is lost. The constants sit beside the `many` gate in
     `src/core/scoring/engine.ts`.
8. **Low-confidence cap.** `lowConfidence = confidence < 0.4`. When true the tier is capped at `some` and
   the badge renders hollow. A `confidenceNote` is attached whenever `confidence < 0.7`, naming the
   missing tier in plain words ("Profile details not loaded yet" / "Extra lookups are off").
9. **Reasons.** Take evidence with `|contribution| ≥ 0.3`, sort by magnitude, keep the top 4, at least 2
   when available. Render each through its template. Negative evidence renders too, so a reader sees what
   pulled the score down ("Account is 6 years old"), and a Likely human card lists what looks ordinary
   ("Custom avatar", "Verified email"). A template that has nothing true to say for its value (a
   handle with no digit run, an account not verified early) renders nothing, and that item is skipped,
   also when filling up to two.
10. **Caveat.** For `typical`, the ordinary-account line (below). Otherwise chosen by the group of the
    largest positive contribution (table below), or by that feature itself where the table gives it a
    caveat of its own (`x.noSleepWindow`, `bsky.noSleepWindow`).

Everything after step 2 is pure and unit-tested against a golden table of synthetic accounts.

## Reason templates and caveats

Templates use the observed values. Durations render as "3 weeks", "6 years"; rates as "~140 posts/day";
counts with thousands separators.

Every reason also carries a **direction** and a **why clause** ([ADR-0022](decisions/ADR-0022-reasons-say-why.md)).
A positive contribution points towards automated (↑ on the card) and a negative one towards ordinary (↓).
A contribution of zero points towards ordinary, as step 7 counts it, unless the feature has no ordinary
clause below: such a feature (the country mismatch, if a policy weighs it at 0) points towards automated
whenever it is stated. The why clause is the one for the reason's direction. The card keeps it hidden
until the reader presses "What these mean" under the reasons, then shows it as a muted sentence on its
own line under the observation ([ADR-0023](decisions/ADR-0023-strength-scale-and-progressive-disclosure.md)).
Each clause condenses the mechanism in "Why each feature is a signal" above, in at most about eight words,
aiming for one 12px line on the 320px card; when a mechanism changes, its clause changes with it. The
clauses live in `src/core/scoring/whyClauses.ts` as lowercase fragments; the card adds the capital and
the full stop. The reason also carries its signed contribution, and `reasonStrength()` in
`src/core/scoring/strength.ts` buckets its size for the card's strength bar: strong from 0.6 (the
threshold the independence rule counts), moderate from 0.3 (the bar a reason clears to be listed on
its own merit, below), weak below, so a weak reason is exactly one listed only to pad the card to two;
the declared reason carries no contribution and no bucket. Two features can word the same
observation (both handle-digit features read "Handle is a name followed by 5 digits"); the card lists
such a line once, from the stronger item.

| Feature | Reason template | Why clause: towards automated / towards ordinary | Caveat (by group) |
|---|---|---|---|
| `x.postsPerDay`, `bsky.postsPerDay` | "~{rate} posts/day since joining" | "prolonged hyperactivity" / "a pace a person keeps up" | activity: "High-volume human posters, news desks and brand accounts show the same pattern." |
| `x.accountAgeDays`, `reddit.accountAgeDays`, `bsky.accountAgeDays`, `hn.accountAgeDays` | "Joined {ago} ago" / negative: "Account is {age} old" | "new accounts often replace banned ones" / "outlasted platform enforcement" | age: "Every account was new once; a recent join date means little on its own." |
| `x.followingRatio`, `bsky.followsRatio` | "Following {following}, followed by {followers}" / negative: "Followed by {followers}, following {following}" | "mass-following nobody returned" / "others opted in" | graph: "People who follow widely before anyone follows back look the same." |
| `x.handleNameDigits`, `x.handleTrailingDigits`, `bsky.handleDigitsOnBskySocial` | "Handle is a name followed by {n} digits" / no contribution: nothing | "unchanged suggested handle" / none | handle: "Many people accept the platform's suggested handle and never change it." |
| `x.handleBigramLL` | "Handle looks randomly generated" / no contribution: nothing | "letter pairs no language uses" / none | handle: as above |
| `x.defaultAvatarEmptyBio`, `bsky.noAvatarEmptyBio` | "No profile photo and no bio" / "No profile photo" / "No bio" / "Has a profile photo and a bio" | "left as created" / "effort spent on this one account" | profile: "Privacy-minded people often leave profiles blank." |
| `x.newAndBlue` | "Verified within {age} of joining" / false: nothing | "paid for reach before having anything to say" / none | verification: "Paid verification is available to any new account." |
| `x.replyShare` | "{pct}% of recent posts are replies" | "it inserts itself into others' threads" / "starts its own threads too" | content: "Some people only ever reply; that is a style, not automation." |
| `x.usernameChanges` | "Username changed {n} times" | "bought or repurposed accounts get renamed" / "too few renames to suggest a resale" | profile: as above |
| `x.countryLocaleMismatch` | "Based in {country}, writes in {language}" / false: nothing | "a persona run from abroad" / none | geo: "Expats, travellers, VPN users and people writing in a second language look the same." |
| `x.gapRegularity`, `bsky.gapRegularity` | "Posts at regular intervals" / no contribution: nothing | "scheduling tools post on a clock" / none | timing: "Accounts that schedule posts with a publishing tool show the same regularity." |
| `x.noSleepWindow`, `bsky.noSleepWindow` | "Posts around the clock" / no contribution: nothing | "no daily quiet window" / none | this feature's own: "Shared and team-run accounts post around the clock." |
| `thread.nearDuplicateReply` | "Reply closely matches an earlier one by another account" / "… earlier ones by {n} other accounts" / no contribution: nothing | "reply templates get reused across accounts" / none | this feature's own: "Popular phrases and memes get repeated by real people." (group coordination: "People reacting to the same post often say the same thing.") |
| `reddit.karmaPerDay`, `hn.karmaPerDay` | "~{rate} karma/day on a {age}-old account" | "karma-farming pattern" / "a pace ordinary use earns" | activity: as above |
| `reddit.karmaSinceFirstActivity` | "~{rate} karma/day since first activity {age} ago" ({age} counted from the oldest visible item; "today" under a day) | "karma-farming pattern" / "a pace ordinary use earns" | this feature's own: "Long-time readers who start posting in large communities can earn karma quickly. Accounts that delete their old posts keep their karma, so the rate can look inflated." |
| `hn.submissionsPerDay` | "{n} posts and comments in {age}" (a rate under one a day reads better as a count) | "prolonged hyperactivity" / "a pace a person keeps up" | activity: as above |
| `hn.hasAbout` | "Has an about section" / false: nothing | "left as created" / "effort spent on this one account" | profile: as above |
| `reddit.postToCommentKarma` | "Post karma {link}, comment karma {comment}" | "reposts earn it without conversation" / "it joins conversations" | content: as above |
| `reddit.generatedName` | "Username matches Reddit's auto-generated pattern" / false: nothing | "kept as suggested" / none | handle: as above |
| `reddit.noAvatar` | "Default avatar" / false: "Custom avatar" | "left as created" / "effort spent on this one account" | profile: as above |
| `reddit.noVerifiedEmail` | "No verified email" / false: "Verified email" | "verifying takes a mailbox per account" / "a mailbox sits behind this account" | profile: as above |
| Declared (label, flair, username, bio) | "Carries the platform's own automated-account label", one per source | "self-declared" (always towards automated) | the declared line below |

### "Why this might be wrong" lines

The card shows the caveat under the label "Why this could be wrong" (ADR-0022), or "What this means" on a
Declared bot card, whose line explains the label rather than arguing against it. For Likely bot and Unsure
it is the group caveat of the strongest positive evidence. The label and that sentence carry the
disclaimer, so a closer follows only when it states something factual about this read:

- When the account is older than two years: "Long-lived accounts are rarely automated; weigh this lightly."
- Otherwise, when `sourcesMissing` is non-empty: "Some signals could not be loaded, so this read is less certain."
- Otherwise nothing. (The closers "This is a pattern read, not a verdict." and "Humans trip these
  signals every day." were dropped by ADR-0022.)

When tier is `typical` (Likely human), in place of the group caveat, a counter-case chosen by the group
of the strongest worded evidence that points towards ordinary, followed by the missing-sources line when
it applies. The card never claims the account is a person, only that nothing stands out:

- age: "An aged account can be bought and repurposed."
- graph: "Followers can be bought."
- profile: "A persona account fills its profile in too."
- any other group: "These signals look like an ordinary account."

When tier is `declared`: "The account operator chose to label it as automated. That is the platform's
recommended, transparent practice."

## Policy override semantics for weights

The signed policy may, per platform and per feature:

- lower `cap` (`min(build, policy)`);
- replace `bins` or `weight`, with every value then clamped to `[-cap, +cap]` using the effective cap;
- replace `thresholds.some` / `thresholds.many`, clamped to `[0.15, 0.95]`, with `many ≥ some + 0.1`;
- replace `prior`, clamped to `[-5, 0]`;
- lower a `groupCap`.

It may not add a feature the build does not know, raise a cap, or move the prior above 0. These rules let
a false-positive pattern be damped within a day without a store release; see `docs/policy-ops.md`.

## Calibration plan

**v1 (before store submission).** A dev-only build flag logs feature vectors, verdicts and provenance to
`storage.local` for roughly 200 accounts seen while browsing X, Reddit and Bluesky normally. Review:

- the tier distribution (target: `many` is rare, under ~5 % of accounts seen in a normal feed);
- every `many` verdict by hand, recording whether the reasons are defensible;
- which features fire most, and whether any fires on obviously ordinary accounts;
- how often `lowConfidence` appears per platform with Tier 2 on and off.

Adjust bins, caps and thresholds in `weights.default.json` before release. After release, the same knobs
are adjustable through the policy file, so a bad pattern can be damped for all users without waiting for
store review.

**v1.x.** Once user feedback ("This looks wrong") and exported dev logs give a few thousand labelled
rows, fit a tiny per-platform model (logistic regression or depth-3 gradient-boosted trees over the same
features), calibrate it with isotonic or Platt scaling on held-out data, and distil it back into bins and
caps. The model runs in the browser; weights ship as data in the policy file, never as code. Do not train
on the public Twitter datasets as the primary signal: their fields are mostly invisible on today's X and
they transfer poorly.

## Wording rules

Amendment 2026-10-22 ([ADR-0017](decisions/ADR-0017-badge-wording-and-label-styles.md)): the rendered badge
labels are now "Likely bot" (many), "Unsure" (some), "Declared bot" (declared) and the optional
"Likely human" (typical, off by default), with a Sus scale and an icon-only label style as settings.
Internal tier names below are unchanged. The rules that follow still govern reason lines, caveats and
every sentence on the hover card: "bot" appears only in the fixed labels and card titles.

Amendment 2026-10-25 ([ADR-0020](decisions/ADR-0020-badge-on-every-account.md)): every tier draws a
badge. "Likely human" is on by default and has to be earned (step 7); `unknown` renders as "No read"
("Who dis" on the Sus scale), reading "Checking" while the account's lookup is queued or running.
Likely human reasons are factual observations of what looks ordinary, and a No read card carries only
the reason there is nothing to read.

Amendment 2026-10-25 ([ADR-0022](decisions/ADR-0022-reasons-say-why.md)): every reason line carries a
direction arrow and a why clause, and the caveat sits under "Why this could be wrong". The rules below
cover the why clauses as reason text: they describe the pattern, never the person, and never contain
"bot". `allFixedStrings()` in `src/core/scoring/reasons.ts` includes every clause, so the wording-rule
test checks them.

Amendment 2026-10-26 ([ADR-0023](decisions/ADR-0023-strength-scale-and-progressive-disclosure.md)):
the clauses wait behind one toggle on the card, and each reason's marker gains a strength bar. The
card's own fixed strings (the marker names such as "Strong, points towards automated" and the toggle
labels "What these mean", "What this means", "Hide explanations", "Hide explanation") come from
`cardFixedStrings()` in `src/ui/cardCopy.ts`. `tests/unit/ui/cardCopy.test.ts` holds them to the same
rules, so the core tests never import the UI.

These apply to every user-visible string in the badge, hover card, popup, options, onboarding and store
listing.

- Never "bot", "fake", "troll", "sockpuppet", "spam account" as a description of a specific account.
- The tier labels are exactly: **Looks typical**, **Some automation signals**, **Many automation signals**,
  **Declared automated**, **Not enough information**.
- The long form is "shows patterns common in automated accounts". Signals are described as observations
  ("Joined 3 weeks ago"), never as accusations ("fake join date").
- The declared state copy is neutral and slightly positive: "This account is labelled as automated by its
  operator, which is the transparent way to run one."
- Every hover card that gives a read shows at least one caveat line; the No read card claims nothing
  and shows only why there is nothing to read. No surface shows a percentage.
- Negative evidence is shown with the same weight as positive evidence.
- Copy about the product says what it does ("highlights patterns") not what accounts are.
