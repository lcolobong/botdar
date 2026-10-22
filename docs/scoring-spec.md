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
- `confidenceWeights`: how much each source tier contributes to confidence when it delivered at least one
  field. They need not sum to 1; confidence is normalised.
- Feature `kind`:
  - `bins`: `[lo, hi, logOdds]` triples, half-open `[lo, hi)`, `null` = unbounded. The first matching bin
    wins. A value matching no bin contributes 0.
  - `bool`: contributes `weight` when true, 0 when false.
- `group`: one of `age`, `activity`, `graph`, `handle`, `profile`, `verification`, `content`, `geo`.

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
| `x.replyShare` | content | 0.8 | `replyShare.ratio` | `[0,0.9)→0` `[0.9,∞)→0.8` | `replyShare.n ≥ 20` |
| `x.usernameChanges` | profile | 0.6 | count from About | `[0,3)→0` `[3,∞)→0.6` | Tier 2 delivered |
| `x.countryLocaleMismatch` (weight 0 until v1.1: the current code compares the account country with the viewer's browser region, not the account's own language; see docs/adversarial-evasion.md) | geo | 0.4 | About country differs from the account's bio language region | bool, 0.4 | Tier 2 delivered; weak and error-prone (VPNs, travel) |

Group caps: `handle` 1.2, `profile` 1.2. Prior `-2.5`. Confidence weights `{0: 0.25, 1: 0.55, 2: 0.20}`.

### Reddit

| Feature | Group | Cap | Input | Bins / weight | Gate |
|---|---|---|---|---|---|
| `reddit.karmaPerDay` | activity | 1.5 | `(linkKarma + commentKarma) / max(ageDays, 1)` | `[0,50)→0` `[50,200)→0.6` `[200,1000)→1.0` `[1000,∞)→1.5` | `ageDays < 180` |
| `reddit.accountAgeDays` | age | 1.2 | days since `createdAt` | `[0,30)→1.2` `[30,180)→0.6` `[180,730)→0` `[730,∞)→-0.6` | `createdAt` known |
| `reddit.postToCommentKarma` | content | 1.0 | `linkKarma / (commentKarma + 1)` | `[0,5)→0` `[5,20)→0.5` `[20,∞)→1.0` | `linkKarma ≥ 500` |
| `reddit.generatedName` | handle | 0.4 | matches `^[A-Z][a-z]+[-_][A-Z][a-z]+[-_]?\d{1,4}$` | bool, 0.4 | always; many humans keep it, so low weight |
| `reddit.noAvatar` | profile | 0.3 | default snoo avatar | bool, 0.3 | Tier 2 delivered |
| `reddit.noVerifiedEmail` | profile | 0.3 | `has_verified_email === false` | bool, 0.3 | field present for other users (day-one check; drop otherwise) |

Prior `-2.8`. Confidence weights `{0: 0.30, 1: 0.0, 2: 0.70}` (Reddit has no Tier 1).

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

Prior `-2.5`. Confidence weights `{0: 0.20, 1: 0.40, 2: 0.40}`. Group caps as X.

### Gating rules

A feature is simply omitted from `toFeatures()` when its gate is not met. An omitted feature contributes
nothing and is not listed as evidence. Gates exist so that a ratio over tiny counts, or a rate over a
one-day-old account, cannot dominate.

## Engine algorithm

Input: `Feature[]` from the platform adapter, the effective platform config, and the signals' provenance.

1. **Declared override.** If `signals.declaredAutomated` is true, return tier `declared` with reasons
   `["Carries the platform's own automated-account label"]`, confidence 1, no scoring.
2. **Empty.** If there are no features, return tier `unknown`, confidence 0.
3. **Contributions.** For each feature, `raw = lookup(spec, value)` (bin value or bool weight), then
   `contribution = clamp(raw, -cap, +cap)`.
4. **Group caps.** For each group with a `groupCap`, sum its positive contributions; if the sum exceeds
   the cap, scale those positive contributions down proportionally so the sum equals the cap. Negative
   contributions are left alone.
5. **Logistic.** `logOdds = prior + Σ contributions`; `p = 1 / (1 + e^(-logOdds))`.
6. **Confidence.** Let `delivered` be the set of tiers that set at least one field in `provenance`.
   `confidence = Σ confidenceWeights[t] for t in delivered / Σ confidenceWeights[all]`. Conservative mode
   therefore reads as lower confidence by design.
7. **Bucketing.**
   - `many` requires all of: `p ≥ thresholds.many`; at least two evidence items with
     `contribution ≥ 0.6` from **distinct** groups (the independence rule); `confidence ≥ 0.5`.
   - Otherwise `some` if `p ≥ thresholds.some`.
   - Otherwise `typical`.
8. **Low-confidence cap.** `lowConfidence = confidence < 0.4`. When true the tier is capped at `some` and
   the badge renders hollow. A `confidenceNote` is attached whenever `confidence < 0.7`, naming the
   missing tier in plain words ("Profile details not loaded yet" / "Extra lookups are off").
9. **Reasons.** Take evidence with `|contribution| ≥ 0.3`, sort by magnitude, keep the top 4, at least 2
   when available. Render each through its template. Negative evidence renders too, so a reader sees what
   pulled the score down ("Account is 6 years old").
10. **Caveat.** Chosen by the group of the largest positive contribution (table below).

Everything after step 2 is pure and unit-tested against a golden table of synthetic accounts.

## Reason templates and caveats

Templates use the observed values. Durations render as "3 weeks", "6 years"; rates as "~140 posts/day";
counts with thousands separators.

| Feature | Reason template | Caveat (by group) |
|---|---|---|
| `x.postsPerDay`, `bsky.postsPerDay` | "~{rate} posts/day since joining" | activity: "High-volume human posters, news desks and brand accounts show the same pattern." |
| `x.accountAgeDays`, `reddit.accountAgeDays`, `bsky.accountAgeDays` | "Joined {ago} ago" / negative: "Account is {age} old" | age: "Every account was new once; a recent join date means little on its own." |
| `x.followingRatio`, `bsky.followsRatio` | "Following {following}, followed by {followers}" | graph: "People who follow widely before anyone follows back look the same." |
| `x.handleNameDigits`, `x.handleTrailingDigits`, `bsky.handleDigitsOnBskySocial` | "Handle is a name followed by {n} digits" | handle: "Many people accept the platform's suggested handle and never change it." |
| `x.handleBigramLL` | "Handle looks randomly generated" | handle: as above |
| `x.defaultAvatarEmptyBio`, `bsky.noAvatarEmptyBio` | "No profile photo and no bio" / "No profile photo" / "No bio" | profile: "Privacy-minded people often leave profiles blank." |
| `x.newAndBlue` | "Verified within {age} of joining" | verification: "Paid verification is available to any new account." |
| `x.replyShare` | "{pct}% of recent posts are replies" | content: "Some people only ever reply; that is a style, not automation." |
| `x.usernameChanges` | "Username changed {n} times" | profile: as above |
| `x.countryLocaleMismatch` | "Account based in {country}" | geo: "Location is inferred by the platform and is often wrong for travellers and VPN users." |
| `reddit.karmaPerDay` | "~{rate} karma/day on a {age}-old account" | activity: as above |
| `reddit.postToCommentKarma` | "Post karma {link}, comment karma {comment}" | content: "Prolific posters who rarely comment look the same." |
| `reddit.generatedName` | "Username matches Reddit's auto-generated pattern" | handle: as above |
| `reddit.noAvatar` | "Default avatar" | profile: as above |
| `reddit.noVerifiedEmail` | "No verified email" | profile: as above |

### "Why this might be wrong" lines

The caveat row always ends with one of these, chosen by context:

- Default: "This is a pattern read, not a verdict. Humans trip these signals every day."
- When `sourcesMissing` is non-empty: "Some signals could not be loaded, so this read is less certain."
- When the account is older than two years: "Long-lived accounts are rarely automated; weigh this lightly."
- When tier is `declared`: "The account operator chose to label it as automated. That is the platform's
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

These apply to every user-visible string in the badge, hover card, popup, options, onboarding and store
listing.

- Never "bot", "fake", "troll", "sockpuppet", "spam account" as a description of a specific account.
- The tier labels are exactly: **Looks typical**, **Some automation signals**, **Many automation signals**,
  **Declared automated**, **Not enough information**.
- The long form is "shows patterns common in automated accounts". Signals are described as observations
  ("Joined 3 weeks ago"), never as accusations ("fake join date").
- The declared state copy is neutral and slightly positive: "This account is labelled as automated by its
  operator, which is the transparent way to run one."
- Every hover card shows at least one caveat line. No surface shows a percentage.
- Negative evidence is shown with the same weight as positive evidence.
- Copy about the product says what it does ("highlights patterns") not what accounts are.
