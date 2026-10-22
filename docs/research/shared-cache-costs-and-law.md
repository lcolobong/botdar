# Shared cache: hosting costs, legal posture, precedents, staleness

Desk research for [shared-cache-exploration.md](../shared-cache-exploration.md), gathered 2026-10-22.
Markers: **[C]** primary source read; **[S]** secondary source; **[I]** inference or arithmetic
not stated by a source; **[NV]** not verified. Treat every [I] and [NV] item as something to check
before relying on it.

## 1. Hosting cost

### Unit prices [C]

| Service | Included on the paid plan | Overage | Source |
|---|---|---|---|
| Cloudflare Workers Paid | $5/mo; 10M requests; 30M CPU-ms | $0.30/M requests; $0.02/M CPU-ms; no egress charge | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Workers KV | 10M reads; 1M writes; 1 GB | $0.50/M reads; $5.00/M writes; $0.50/GB-mo | same |
| D1 | 25B rows read; 50M rows written; 5 GB | $0.001/M rows read; $1.00/M rows written; $0.75/GB-mo | same |
| Durable Objects (SQLite) | 1M requests; 400k GB-s; D1 row quotas; 5 GB | $0.15/M requests; $12.50/M GB-s; $0.20/GB-mo | same |
| R2 | 10 GB; 1M Class A; 10M Class B | $0.015/GB-mo; $4.50/M Class A; $0.36/M Class B; egress free | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Fly.io shared-cpu-1x | no free tier for new orgs | 1 GB $6.70/mo; volume $0.15/GB-mo; egress $0.02/GB | [Fly pricing](https://docs.fly.io/about/pricing) |
| Supabase | Free: 500 MB DB, 5 GB egress, paused after a week idle. Pro $25/mo: 8 GB, 250 GB egress | $0.125/GB disk; $0.09/GB egress | [Supabase pricing](https://supabase.com/pricing) |
| Neon | Free: 100 CU-h, 1 GB, 5 GB egress, suspends when idle | Launch: $0.106/CU-h, $0.35/GB-mo | [Neon pricing](https://neon.com/pricing) |

### Assumptions [I]

- Every weekly active user is active every day (an upper bound; halve the usage lines if daily
  actives are half of weekly).
- Per user per day: 300 lookups in 12 batches of 25; 15 writes (5% of lookups). A batch carries at
  least one write with probability 1 − 0.95^25 ≈ 0.72, so about 8.7 write requests a day. Worker
  requests per user-month ≈ (12 + 8.7) × 30 ≈ 621.
- KV bills per key read: 9,000 reads and 450 writes per user-month. Whether bulk-get changes the
  billing was not checked [NV].
- Distinct accounts stored: 0.2M / 0.8M / 2M (only the 2M figure came from the brief). 2M records
  × 300 B = 0.6 GB before index overhead.
- About 2 ms CPU and 2 KB response per request.

### Monthly cost [I, arithmetic from the prices above]

| Weekly active users | 1,000 | 10,000 | 100,000 |
|---|---|---|---|
| Worker requests | 0.62M (included) | 6.2M (included) | 62M → $15.63 |
| CPU-ms | 1.2M (included) | 12M (included) | 124M → $1.88 |
| **A. Workers + KV** | **$5** | **$62.50** (80M extra reads $40, 3.5M extra writes $17.50) | **≈ $688** (890M extra reads $445, 44M extra writes $220) |
| **B. Workers + D1** (primary-key `IN (…)`) | **$5** | **$5** | **≈ $23** (900M rows read and ≈ 47M written stay inside the included quotas) |
| **C. Workers + one Durable Object** | $5 | $5 | ≈ $32 (B plus 61M DO requests at $0.15/M) |
| **D. Fly.io 1 GB VM + SQLite** | ≈ $7 | ≈ $7 | ≈ $9 for one machine (124 GB egress at $0.02/GB); double for two-machine HA |
| **E. Supabase** | free tier | Pro $25 (egress over 5 GB) | $25 (0.6 GB plus indexes exceeds the free 500 MB; Micro compute throughput [NV]) |
| **F. Neon Launch** (still needs an API in front) | free tier likely exhausted by always-on compute | ≈ $20 | ≈ $20 (0.25 CU × 720 h) |

Average load at 100k weekly actives ≈ 24 requests/s; peak not estimated [I]. Workers, KV, D1, DO and
R2 charge no egress [C]; Fly, Supabase (above 250 GB) and Neon (above 500 GB) do [C].

Pitfalls: KV is eventually consistent and allows about one write per second per key, so a popular
account written by many users collides [NV]; D1 is one database per binding and serialises writes,
throughput limits not fetched [NV].

### Static-first variant (Safe Browsing shape) [I]

- 2M accounts in 4,096 shards ≈ 488 records × ~20 B ≈ 10 KB each, in R2 behind the Cloudflare cache.
- Rebuilding every shard hourly: 4,096 × 720 = 2.95M Class A → ≈ $8.77/mo.
- Worst case with no cache hits: 9,000 GETs per user-month, 900M Class B at 100k users → ≈ $320/mo.
  Cache hits do not reach R2, and clients can keep a shard for its TTL, so the real figure depends
  on hit rate (not measured).
- Shipping the full list to every client: 2M × 9 B (8-byte prefix + tier byte) ≈ 18 MB, then diffs.
- Cost roughly matches D1 when the cache works and beats KV always; the real difference is privacy:
  the server never learns which account a user looked up. Disputes and contributions still need a
  dynamic write endpoint.

### The reference privacy designs [C]

- Google Safe Browsing v4 Update API: clients hold a local database of 4-byte hash prefixes and send
  only a matching prefix to fetch full hashes; Google "at no point" learns the URLs, but does learn
  prefixes ([v4 docs](https://developers.google.com/safe-browsing/v4/update-api)). v5 adds an
  Oblivious HTTP gateway so "end users' IP addresses are no longer sent to Google"
  ([v5 reference](https://developers.google.com/safe-browsing/reference)).
- Have I Been Pwned Pwned Passwords: the client sends the first 5 hex characters of a SHA-1 and
  receives ~800 suffixes, optionally padded to 800 to 1,000 ([API v3](https://haveibeenpwned.com/API/v3)).

## 2. Legal and privacy

### GDPR

| Question | Finding | Status |
|---|---|---|
| Is a public username plus an inferred label personal data? | Very likely yes: a handle identifies a natural person directly or indirectly (Art. 4(1)) and an inference "relates to" them. The CJEU in *EDPS v SRB* (C-413/23 P, 4 Sep 2025) held that opinions relate to the people they are about ([summary](https://www.mondaq.com/germany/data-protection/1677152/cjeu-clarifies-scope-of-personal-data-in-edps-v-srb-decision)) | [I]; case [S] |
| Household exemption, Art. 2(2)(c) | Not available for a cache shared with the public; *Lindqvist* (C-101/01) held that publication to an indefinite audience is not household activity | [I]; case not read |
| Lawful basis | Art. 6(1)(f) legitimate interests with the three-part test (purpose, necessity, balancing incl. reasonable expectations) ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/what-is-the-legitimate-interests-basis/)). EDPB [Guidelines 1/2024](https://www.edpb.europa.eu/our-work-tools/documents/public-consultations/2024/guidelines-12024-processing-personal-data-based_en?page=1) adopted for consultation Oct 2024; final version not confirmed | [C] / [S] |
| Art. 14 notice when data are not collected from the subject | Due within a month (14(3)(a)). 14(5)(b) exempts "disproportionate effort" but the controller must then "take appropriate measures … including making the information publicly available" ([text](https://gdpr-info.eu/art-14-gdpr/)). ICO: the assessment must be documented, the exemption is "the exception, not the rule", privacy information must still be published, a DPIA should be done, and "the more significant the effect, the less likely" the exception applies ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/are-there-any-exceptions/)) | [C] |
| Art. 16 rectification | Applies; for an inference, accuracy means correctly recorded and labelled as an inference, with a right to add a supplementary statement | [I] |
| Art. 21 objection | Applies to 6(1)(f) processing "including profiling"; processing stops unless "compelling legitimate grounds" are shown ([text](https://gdpr-info.eu/art-21-gdpr/)) | [C] |
| Art. 17 erasure | 17(1)(c) triggers erasure after a successful objection | [I] |
| Art. 22 automated decisions | Only decisions "based solely on automated processing" with "legal effects … or similarly significant" ones ([text](https://gdpr-info.eu/art-22-gdpr/)); a badge with no such effect is probably outside it, but profiling stays subject to Art. 21. UK applies the same test under Arts. 22A–22D ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/automated-decision-making-and-profiling/)) | [C] / [I] |
| Salted hash of the handle | Pseudonymised data stay personal data even when the key is held elsewhere (EDPB [Guidelines 01/2025](https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf), ¶88 and fn. 23: a plain hash of a name is reversible by hashing known names; secrets need "sufficient entropy"). ICO: predictable inputs invite dictionary attacks ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/pseudonymisation/)). **Handles are public and enumerable, and an open-source client must compute the key, so any salt it ships is public; the hash protects nothing against a determined reader** | [C] / [I] |

### CCPA/CPRA [C, from the CPPA's Act text](https://cppa.ca.gov/regulations/pdf/cppa_act.pdf)

- A "business" (1798.140(d)) is an entity operated for profit that also meets a threshold: more than
  $25M revenue, or buying/selling/sharing personal information of 100,000+ consumers, or 50%+ of
  revenue from selling or sharing it. A free, non-commercial project with no for-profit entity is
  probably not a business [I]; the 100,000 threshold is about selling or sharing, not storing.
- Inferences "drawn … to create a profile" are personal information (1798.140(v)(1)(K)).
- "Publicly available" (1798.140(v)(2)) covers information "lawfully made available to the general
  public by the consumer" or not restricted to a specific audience; a public profile qualifies [I],
  the project's own "likely automated" inference arguably does not, since the project created it [I].

### Defamation

- **US.** *Milkovich v. Lorain Journal*, 497 U.S. 1 (1990), rejected a blanket opinion exemption; the
  test is whether a statement is "sufficiently factual to be susceptible of being proved true or
  false" ([LII](https://www.law.cornell.edu/supremecourt/text/497/1)) [C]. "Is automated" is arguably
  provable; hedged wording ("likely") with the underlying signals shown fits the disclosed-facts line
  (Restatement (Second) of Torts §566 [NV]) [I]. In *Broughty v. Bouzy* (D.N.J.) a Bot Sentinel
  "disruptive" rating was part of a defamation claim; the plaintiff, a limited-purpose public figure,
  lost ([Goldman](https://blog.ericgoldman.org/?p=25421)) [S].
- **UK.** Defamation Act 2013 s.1 requires "serious harm" (serious financial loss for a trading body)
  ([s.1](https://www.legislation.gov.uk/ukpga/2013/26/section/1)) [C]; *Lachaux* [2019] UKSC 27 makes
  that a factual inquiry [S]. Honest opinion (s.3) needs: a statement of opinion; an indication of
  "the basis of the opinion"; and that an honest person could have held it on the facts; defeated if
  the defendant did not hold it ([s.3](https://www.legislation.gov.uk/ukpga/2013/26/section/3)) [C].
  Showing the signals behind a label is condition 2 [I].

### Chrome Web Store [C]

- "Web browsing activity" and "Website content and resources" are user data
  ([User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)); the
  handles a user sees are therefore user data once sent anywhere [I].
- Required: a privacy policy in the dashboard; HTTPS; a prominent in-product disclosure with
  affirmative consent that "must not be located only in a privacy policy", and the store description
  does not count ([disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements));
  changes after install announced prominently.
- Limited Use: data may only serve the "disclosed single purpose"; transfers restricted; human
  access only in listed exceptions ([Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)).

## 3. Precedents

| Precedent | Mechanism or outcome | Status |
|---|---|---|
| Bot Sentinel | Defamation suit over a "disruptive" rating plus the founder's tweets; plaintiff lost ([Goldman](https://blog.ericgoldman.org/?p=25421)); Twitter cut its API access Aug 2022 ([Wikipedia](https://en.wikipedia.org/wiki/Bot_Sentinel)) | [S] |
| Botometer | Rauchfleisch & Kaiser 2020 (n = 4,134): imprecise, thresholds drift, worse for non-English accounts ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7580919)); no legal threats found | [S] |
| Bluesky labels (Ozone) | Labels carry optional `exp` (expiry) and `neg` (retraction); expired labels are not hydrated ([label spec](https://github.com/bluesky-social/atproto-website/blob/main/src/app/%5Blocale%5D/specs/label/en.mdx)). Appeals are reports with `reasonAppeal` ([lexicon](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/moderation/defs.json)). 93,076 users filed 205K appeals in 2024 ([2024 report](https://bsky.social/about/blog/01-17-2025-moderation-2024)); 267,509 users appealed in 2025, all human-reviewed ([2025 report](https://bsky.social/about/blog/01-29-2026-transparency-report-2025)) | [C] |
| X Community Notes | Matrix factorisation; intercept regularisation (0.15) is 5× factor regularisation (0.03), so a note must be rated helpful across viewpoints; Helpful needs score ≥ 0.40, at least 5 ratings, and Not Helpful needs ≥ 3 from each side; retrained hourly ([ranking-notes.md](https://github.com/twitter/communitynotes/blob/main/documentation/under-the-hood/ranking-notes.md)) | [C] |
| Wikipedia | Consensus "is not the result of a vote" but "the quality of the arguments" ([WP:CON](https://en.wikipedia.org/wiki/Wikipedia:Consensus)) | [C] |
| Have I Been Pwned | Opt-out by email verification removes the address from public search including future breaches, no timeframe stated ([OptOut](https://haveibeenpwned.com/OptOut)) | [C] |
| DNSBL practice, RFC 6471 | Listings "SHOULD be considered temporary and should expire on their own"; operators "SHOULD respond within 2 days and MUST respond within 7 days" to removal requests; provide a non-public removal channel and publish an expiry policy ([RFC 6471](https://www.rfc-editor.org/rfc/rfc6471)) | [C] |
| Spamhaus XBL | Listings "automatically expire … once the malicious behavior is no longer detected"; removal only through the self-serve checker; relists on repeat ([XBL](https://www.spamhaus.org/xbl/)) | [C] |

## 4. Staleness

- Bluesky 2025: 2.08M accounts actioned, 16.49M labels (95% automated); no time-to-action published
  ([2025 report](https://bsky.social/about/blog/01-29-2026-transparency-report-2025)) [C]. 2024:
  35,842 accounts removed by automation for spam and bot networks; most reports handled "within 40
  minutes" before the August surge ([2024 report](https://bsky.social/about/blog/01-17-2025-moderation-2024)) [C].
- X: about 464M spam accounts taken offline in H1 2024 ([Fortune](https://fortune.com/2024/09/25/twitter-x-account-suspensions-triple-transparency-report-elon-musk)) [S]. The only time-to-suspension figure is old: 77% of spam accounts suspended within a day of their first tweet (Thomas et al., IMC 2011) ([paper](https://people.eecs.berkeley.edu/~dawnsong/papers/2011%20Suspended%20accounts%20in%20retrospect%20an%20analysis%20of%20Twitter%20spam.pdf)) [S].
- Reddit H1 2025: 55.1M posts and comments removed by admins, 40.9M for spam ([Statista](https://www.statista.com/statistics/1255249/reddit-content-removed-by-violation)) [S].
- Handle changes: about 10% of 8.7M Twitter users changed usernames, 61% of changes within 24 h of a
  previous change (2014 data, [arXiv 1405.6539](https://arxiv.org/pdf/1405.6539)) [S]. Reddit
  usernames are permanent [S]. Bluesky handles change over a stable DID; X has stable numeric ids [I].

## Gaps

KV per-key write limits and D1 throughput; KV bulk-get billing; Neon minimum CU and Supabase Micro
throughput; the EUR-Lex text of Arts. 2(2)(c), 4(1), 4(5), 16 and 17 and the *Nowak*, *Lindqvist*,
*SRB* and *Lachaux* judgments (secondary only); the CCPA inflation-adjusted revenue figure; Stack
Overflow's close-vote rules; Reddit's and X's primary 2025 transparency reports; whether Safe Browsing
v4 is deprecated. No platform publishes time from account creation to suspension.
