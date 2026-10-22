# Test plan

Date: 2026-10-22. Architecture context in [architecture.md](architecture.md); scoring detail in
[scoring-spec.md](scoring-spec.md).

## Principles

- Every parser is tested against recorded, anonymized fixtures and against a deliberately mangled
  fixture. A parser returns partial signals; it never throws into the page.
- Scoring is tested with a golden table of synthetic accounts and expected tiers so weight changes are
  reviewed as diffs.
- The policy system has a full "cannot enable" matrix: no policy input may turn on a source, raise a
  cap, or lower a prior below the build default.
- Nothing that touches a live platform runs in CI.

## Layers

| Layer | Tool | What is covered |
|---|---|---|
| Scoring engine | Vitest (node) | bin lookup, per-feature caps, group caps, logistic, confidence, bucketing, independence rule, low-confidence cap, declared and unknown states, golden table |
| Handle shape | Vitest | digit and pattern features, Reddit generated-name detector positives and negatives, bigram log-likelihood on random vs natural handles |
| Policy | Vitest | validator (every field, wrong types), restrict-only merge matrix, settings overlay, signature verify with a test keypair (valid, tampered payload, wrong key, bad base64, version rollback) |
| Parsers | Vitest + fixtures | X GraphQL user objects in `core.*` and `legacy.*` shapes plus a mangled one; Reddit `about.json` normal, suspended, HTML redirect; Bluesky `getProfiles` and feed author objects incl. `bot` self-label |
| DOM mounting | Vitest, happy-dom | badge mounts on saved tweet, shreddit and bsky snippets; idempotent on a second pass; unmounts on node removal; per-page state resets on route change |
| Rate limiter and cache | Vitest fake timers | token refill, backoff ladder, circuit open reports the source as missing; TTL expiry and LRU eviction |
| Background | Vitest + WXT fake browser | alarm registration, last-known-good untouched on every failure mode, config broadcast after refresh and after settings change |
| Smoke and media | Playwright script, not a CI gate | built extension loaded against fixture pages served locally; screenshots of each tier and the hover card on each platform, light and dark; `--live` for manual captures in a logged-in profile |

## Manual checklist (run before every release)

1. X: scroll the home timeline, open a reply-heavy thread, open a profile and its "About this account"
   panel. Badges appear on every author; hover shows reasons; Tier 2 lookups fire only on hover and stop
   after the limiter trips.
2. Reddit: browse a subreddit feed and a comment thread on new Reddit; repeat on old.reddit if the
   variant shipped. A user with the [App] tag shows the declared state.
3. Bluesky: scroll the Discover feed and a thread. A self-labeled bot shows the declared state alongside
   Bluesky's own robot badge.
4. Conservative mode: turn it on; confirm no active lookups happen (network panel) and confidence drops.
5. Platform toggle: turn X off; confirm no badges and no interceptor messages on X.
6. Policy: flip a value in `policy/src/v1.json`, re-sign, publish, force the alarm from the service
   worker console; confirm the change is live. Publish a tampered file; confirm it is rejected and the
   last-known-good stays.
7. Data egress: with the network panel open on each platform for five minutes of normal browsing, the
   only extension-originated request is the policy fetch.
8. Feedback: click "This looks wrong", export from the options page, confirm the JSON contains only
   what the card showed.

## Calibration pass

Before the first store submission, a dev-only build logs feature vectors locally for about 200 accounts
across the three platforms. Check the tier distribution (expect most accounts "typical"), review every
"many" by hand, and adjust prior and thresholds through the policy file rather than a release.

## What cannot be automated

Live platform behavior (auth, anti-bot, Terms), GraphQL and DOM schema rotation, store reviews,
Firefox MAIN-world timing at `document_start`, and visual regressions caused by platform redesigns. Each
has a manual step above or a monitoring note in [risk-register.md](risk-register.md).
