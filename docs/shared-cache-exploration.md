# Shared verdict cache: a design exercise

Status: exploration, not a plan. Written 2026-10-22 at the user's request to think through what a
shared cache of account signals would involve, what it would cost to run, what the legal exposure
is, how stale data would be handled, and how someone could dispute a label. The v1 non-goal in
[product-brief.md](product-brief.md) ("no backend, no shared verdict cache") stands. The outcome is
recorded in [decisions/ADR-0018](decisions/ADR-0018-no-shared-cache-yet.md).

Figures marked (research) come from the sourced sweep in
[research/shared-cache-costs-and-law.md](research/shared-cache-costs-and-law.md).

## Why anyone would want it

Today every user computes every verdict from scratch. Tier 0 and Tier 1 are free: the page already
contains the data. Tier 2 is the expensive part: on hover the extension asks the platform for a
profile, rate-limited (X 20/min burst 3, Bluesky 30/min), cached in memory for 24 hours and gone
when the tab closes. A shared cache would promise three things:

1. **Fewer platform requests.** If one user has looked an account up today, nobody else needs to.
   That lowers the account-lock risk (R-05) and the request volume X could point at (R-01).
2. **Verdicts on first paint.** Tier 2 signals arrive with the page instead of on hover, so more
   accounts reach a confident tier without the user doing anything.
3. **A place for memory.** Signals that only make sense across many observations (an account that
   changed handle, a burst of near-identical replies across threads, the coordination signals in
   [adversarial-evasion.md](adversarial-evasion.md)) need somewhere to accumulate.

It also promises three problems, which are the subject of the rest of this document: a server that
can be pressured, a dataset that can be poisoned, and a list of named accounts with a label next to
each one, which is the exact artefact the project has avoided producing so far.

## What would be stored

The cloud-layer seam in [architecture.md](architecture.md#cloud-layer-seam) already decides the
most important thing: a cloud source returns signals, never a verdict. That rule does more work
here than anywhere else, so it is worth restating what it buys.

| Store this | Not this | Why |
|---|---|---|
| `createdAt`, follower and following counts, post count, karma, display name, bio length, default-avatar flag, declared-automation flag, the platform's own labels | The tier, probability or log-odds | Scoring stays local and under the user's own policy and settings. A weight change never invalidates the cache. Legally the record is a copy of facts the platform publishes about the account, not an opinion we hold about it |
| Which tier delivered each field and when it was observed | Who observed it | Provenance drives confidence; contributor identity is a liability and never needed by the client |
| The platform's stable account identifier (X `rest_id`, Reddit `t2_` id, Bluesky DID) as the key, with a separate short-lived handle-to-id map | The handle as the key | Handles change; ids do not. A stale handle mapping is the most likely way to badge the wrong person |
| A count of independent observations and the latest observation time | Any free text from users | Text is where defamation lives |

So a record is `{ platform, accountId, signals: Partial<AccountSignals> with per-field provenance and observedAt, observations, updatedAt }`, about 300 bytes. The client merges it as one more
`SignalSource` with `tier: 2`, `kind: "active"`, and the engine treats it as **one evidence group**
no matter how many fields it carried, so a shared record alone can never lift an account to "Likely
bot": the two-independent-groups rule in [scoring-spec.md](scoring-spec.md) still needs a local
signal to agree.

## Four shapes, from cheapest to most capable

### A. Persist the local cache (no server)

Keep the in-memory 24-hour Tier 2 cache in `storage.local` for seven days, keyed by a salted hash
of platform + account id. One user who follows the same people gets most of the benefit of a shared
cache for free. Cost: zero. Legal: the data stays on the user's device, which is where it was
anyway. It needs an amendment to ADR-0012 (no per-account data at rest) and a line in
[privacy.md](privacy.md). This is the only shape that could plausibly land in v1.x.

### B. Static shards on a CDN, maintainer-produced

The server never answers a query. A pipeline publishes signed shard files (say 256 files split by
the first byte of the hashed account id) to the same GitHub Pages site as the policy, and the
client downloads the shard it needs, checks locally, and keeps it for a day. This is the Safe
Browsing Update API shape (research): the server learns which shard a client wanted, never which
account, and the usual CDN caching means reads cost nothing. The catch is production: someone has
to observe the accounts. A maintainer-run crawler is a ToS problem on X and Reddit, a single point
of pressure, and would see only accounts the maintainer chose to look at. The honest version of B
is "B fed by C".

### C. Opt-in contributions, static or live reads

Users who opt in upload the signal summaries their own browser already extracted from pages they
were already reading. Everyone (or everyone who opts in) reads. Reads can be static shards (B) or a
live key-value lookup. This is the first shape where **browsing activity leaves the browser**: an
upload says "this user saw this account at this time", and a live read says "this user is looking
at this account now". Both need the Chrome Web Store Limited Use disclosure and a privacy policy
change (research), and both need the server to keep no request logs that tie accounts to IPs.
Mitigations exist (batch uploads delayed by hours, k-anonymity prefix queries as Have I Been Pwned
does, an OHTTP relay) and each one costs engineering and some utility.

### D. Live shared cache with cross-account signals

Shape C plus server-side computation: near-duplicate reply detection across contributors, shared
rare-domain clustering, handle-change history, suspension tombstones. This is the only shape that
delivers the coordination signals the evasion analysis says will matter most over time. It is
also a backend that stores post text or hashes of it, needs a real data-retention regime, and is
the thing a platform's lawyers would describe as "a scraping operation with a database".

## What it would cost

Assumptions for the arithmetic: a user sees about 300 distinct accounts a day, looked up in batches
of 25 (12 reads a day); 5% of lookups produce a write; a record is 300 bytes; records expire after
30 days; roughly 2M distinct accounts are stored at the largest tier.

Monthly hosting for Shape C, from the 2026 price pages (research, section 1; arithmetic marked
[I] there, and an upper bound because it treats every weekly active user as daily):

| Weekly active users | 1,000 | 10,000 | 100,000 |
|---|---|---|---|
| Cloudflare Workers + D1 | $5 | $5 | ≈ $23 |
| Cloudflare Workers + KV | $5 | ≈ $63 | ≈ $688 |
| One Fly.io 1 GB machine + SQLite | ≈ $7 | ≈ $7 | ≈ $9 (double for two machines) |
| Supabase / Neon Postgres (plus an API layer) | free / ≈ $0 | $25 / ≈ $20 | $25 / ≈ $20 |
| Static shards in R2 (Shape B read path) | ≈ $9 rebuild | ≈ $9 rebuild | ≈ $9 rebuild, plus $0 to ≈ $320 of reads depending on cache hit rate |

Two things the table says. First, the bill is small: a D1-backed Worker at a hundred thousand users
costs about what a streaming subscription does, because Cloudflare charges no egress and the row
quotas absorb nine hundred million reads a month. Second, the obvious key-value choice is the wrong
one: KV costs thirty times more at scale and allows about one write per second per key, so a viral
account written by thousands of users at once would collide. Average load at the top tier is about
24 requests a second; peaks were not estimated.

The number that matters is not the hosting bill. It is the hours. A shared cache needs:

| Recurring work | Estimate | Why it is unavoidable |
|---|---|---|
| Abuse response: poisoned contributions, scraping of the dataset, denial-of-wallet | A few hours a month, bursts around incidents | The write path is public by construction |
| Data-subject requests: "remove my account", "correct this record" | Hours per request until a self-serve path exists | GDPR Art. 16, 17, 21 (research) |
| Takedown and pressure correspondence | Unbounded | The server is the thing a platform can write to |
| Key rotation, dependency updates, schema migrations | Half a day a quarter | Any backend |
| Dispute adjudication (next section) | Proportional to users | Someone has to read them |

For a solo maintainer this is the real cost, and it is the cost the local-only design was chosen
to avoid (ADR-0002, R-13 bus factor).

## Legal exposure

Findings with citations are in section 2 of the research doc; the summary:

- **GDPR applies and the household exemption does not.** A public handle plus an inference about the
  account is personal data (the CJEU held in *EDPS v SRB*, 2025, that an opinion relates to the
  person it is about), and *Lindqvist* settled that publishing to an indefinite audience is not a
  household activity. The lawful basis is legitimate interests, Art. 6(1)(f), which needs a documented
  three-part test. Art. 14 asks the project to notify the people it holds data about within a month;
  with millions of accounts that is the "disproportionate effort" case, which the ICO calls "the
  exception, not the rule" and which still requires published privacy information and, in its
  guidance, a data protection impact assessment. The rights to rectification (Art. 16), objection
  (Art. 21, explicitly including profiling) and erasure after a successful objection (Art. 17) all
  apply. Art. 22 on automated decisions probably does not, since a badge has no legal or similarly
  significant effect.
- **CCPA probably does not apply** to a free project with no for-profit entity, because the Act's
  definition of a "business" starts from an entity operated for profit. If it ever did, the public
  profile fields are "publicly available" and excluded, but the project's own inference is not.
- **Defamation posture is the same in both systems.** The US test from *Milkovich* is whether a
  statement is provable as true or false; "likely automated" with the signals shown fits the
  disclosed-facts line, and the one on-point case (*Broughty v. Bouzy*, over a Bot Sentinel rating)
  went the defendant's way. The UK's honest-opinion defence needs the statement to indicate "the basis
  of the opinion", which the hover card's reason lines do, and the serious-harm threshold means a
  badge most readers never hover is unlikely to clear it.
- **The Chrome Web Store treats the handles a user sees as browsing activity.** Sending them anywhere
  needs a prominent in-product disclosure with affirmative consent, not just a privacy policy line,
  and a Limited Use single-purpose statement.

The design consequences that hold regardless of jurisdiction:

- **Store facts, not labels.** A record of "created 2026-09-30, follows 4,900, followed by 12" is a
  copy of what the platform shows. "Likely bot" next to a name is an opinion we publish. The seam
  rule keeps the opinion local, computed by the user's own browser from disclosed facts, which is
  also the strongest defamation posture in both US and UK law (research).
- **Hashing the key buys almost nothing in an open-source client.** A salted hash of a public
  handle is pseudonymised, not anonymous, and the EDPB's 2025 guidelines say pseudonymised data stay
  personal data even when the secret is held elsewhere. Worse, every client has to compute the key,
  so any salt the extension ships is public, handles are enumerable, and a dictionary attack recovers
  the dataset. Hash anyway, to keep the handle out of casual view and off disk in plain text, but
  treat the store as a list of named accounts, which it is, and design the erasure path from day
  one.
- **Have a notice and a DPIA.** Art. 14's disproportionate-effort route still requires published
  privacy information, and the ICO expects a data protection impact assessment alongside it. A page
  on the project site saying what is stored, for how long, and how to be removed is the minimum.
- **Keep no request logs that pair an account with a user.** The reader's browsing is the more
  sensitive dataset, and it is the one the project has promised never to collect.
- **Say it in the store listing.** Any upload is "user data" under Chrome's User Data Policy and
  must be disclosed before the source ships (research).

## Staleness policy

Signals age at different rates, so one TTL is wrong for all of them. The platforms publish no
figure for time from creation to suspension; the only one on record is from 2011, when 77% of
Twitter spam accounts were suspended within a day of their first tweet, and Bluesky reported
handling most reports "within 40 minutes" in 2024. Both argue for short lifetimes on anything that
asserts an account is still there, and for tombstones rather than silence when it is not. On handle
changes, 2014 data had about 10% of Twitter users renaming at least once, with most repeat renames
inside a day, which is why the key is the platform id and the handle map lives for 24 hours.

| Field | Volatility | TTL | Refresh rule |
|---|---|---|---|
| `createdAt`, account id | Immutable | Never expires while the record lives | n/a |
| Handle-to-id mapping | Changes on rename | 24 h | Any contributor who sees a different handle for the id replaces it; a conflicting observation within the window marks both handles unknown until re-observed |
| Follower, following, post counts, karma | Drift daily | 7 days | Overwrite on newer observation; the client scores on its own fresher Tier 0/1 numbers when it has them |
| Default avatar, bio length, display name | Change rarely | 7 days | Overwrite on newer observation |
| Declared automation, platform labels | Can flip either way | 24 h | Overwrite; a flip to "not declared" is as valid as a flip to "declared" |
| Suspension or deletion | Terminal | Tombstone 30 days, then delete | Any contributor who gets a 404 or a suspended page writes the tombstone; the client shows no badge for a tombstoned account |
| Whole record | | 30 days without any observation | Hard delete. Refresh-on-read never extends life; only a new observation does |

Three rules on top of the table:

1. **Records carry a schema version.** A client with a newer feature set ignores fields it does
   not understand and never writes fields older clients would misread.
2. **The policy file can drain the cache.** The cloud source is a Tier 2 active source, so the
   existing restrict-only policy can switch it off per platform within a day
   ([policy-ops.md](policy-ops.md)). A separate server-side `drain` flag stops accepting writes and
   serves tombstones only, for the day a takedown arrives.
3. **Nothing is backfilled.** When a field's meaning changes (as `x.countryLocaleMismatch` did in
   [adversarial-evasion.md](adversarial-evasion.md)), the old field is retired by name, not
   reinterpreted.

## Disputes

The user asked for a way for someone to dispute whether an account is or is not a bot. There are
three different people who might dispute, and they need different mechanisms.

### 1. A reader who thinks a badge is wrong

This exists today: "This looks wrong" records the handle, tier and reasons locally, exportable as
JSON, never sent anywhere ([feedback.ts](../src/core/feedback.ts), ADR-0012). With a shared cache
the natural extension is to let an opted-in reader send the same record to the server, where it
attaches to the account's record as a **disagreement count**, not as a label.

What a disagreement does: it lowers the confidence the client assigns to the shared record for that
account, and nothing else. Enough independent disagreements and the shared record contributes
nothing, so the account falls back to whatever the reader's own browser can see. A disagreement can
never push an account toward "Likely bot", even when the reader's complaint is "this is obviously a
bot and you missed it". That direction is recorded locally only, as calibration data, because a
hosted per-account "users say this is a bot" counter is an accusation the project would be
publishing.

What stops brigading: a bot operator could file a thousand disagreements to whitewash their
network, and a mob could file a thousand to hound a real person. The counter-measures are the ones
every reputation list uses (research): each contributor has a random token minted on opt-in whose
weight grows with age and with the share of its past contributions that later observations
confirmed; a token can disagree once per account; disagreements from tokens younger than a week
carry no weight; and the maximum effect of disagreements is "no shared contribution", never "shared
evidence of humanity". The first and last rules mean brigading can at worst return an account to
the local-only verdict it would have had without the cache.

### 2. The account's owner

This is the dispute that matters legally, because it is the right of rectification and objection
in practice (research). It needs proof of control, and each platform offers one without any
cooperation from the platform:

| Platform | Proof of control |
|---|---|
| Bluesky | Sign a challenge with the account's DID key, or publish a record under the account's repo; verifiable by anyone against the public PDS |
| Reddit | Post a one-time code in a self-text post or the profile bio; verified by fetching the public page |
| X | Put a one-time code in the bio or pin a post containing it; verified by fetching the public page (needs the same Tier 2 path the extension already has) |

What an owner dispute does: it sets an **owner-contested** flag on the record for 90 days. While
the flag is set the client caps the account at "Unsure" and the hover card says the owner has
contested the signals. It does not say "verified human", because the proof shows control of the
account, not that a person operates it; a bot operator can complete it just as easily, and that is
fine: an operator who contests and is capped at "Unsure" has told us exactly what the declared-bot
path already tells us, and the honest wording for both is the same. The owner can also ask for the
record to be deleted, which is the erasure path, and deletion plus a tombstone that expires in 30
days means the account simply gets re-observed later with fresh facts.

What stops abuse: nothing needs to, because the worst an attacker can do with a stolen proof is
cap someone else's account at "Unsure", which is the extension's default state of uncertainty.

Response time is the part a process doc has to commit to. The DNS blocklist community's RFC 6471
says operators "SHOULD respond within 2 days and MUST respond within 7 days" to a removal request
and should offer a non-public removal channel; Have I Been Pwned's opt-out is self-serve by email
verification with no human in the loop. Owner proof of control is the self-serve path here, and the
two-day / seven-day windows are the right commitment for anything that needs a person.

### 3. The project itself

A public dispute log is the process the project would need when a platform or a journalist asks
"why did you label this account": a page per dispute with the facts that were stored, the dates,
and the outcome, with the account id hashed. This is the Spamhaus pattern: listings expire on their
own once the behaviour stops, removal is self-serve, and the credibility of the list comes from a
visible, boring process. Bluesky's label protocol makes the same point in the data model: every
label can carry an expiry and can be negated by a later label, and expired labels are simply not
served. A shared record here should carry both from the start.

The scale to expect: Bluesky's own moderation handled 205,000 appeals from 93,000 users in 2024 and
had 267,000 users appeal in 2025, every one human-reviewed. A labeler at a few percent of that size
is still a part-time job.

### What the user asked and what this design says

"Dispute if someone is or isn't a bot": readers can say a label is wrong, and that only ever makes
the extension less sure. Owners can prove control and get capped at "Unsure" and a right of reply.
Nobody, including the project, publishes "this account is a bot" about a named account; the
extension keeps saying "likely", locally, from facts it can show.

## Does a cache even help the platform-pressure risk?

Both ways. Fewer Tier 2 requests to X is good. But the request volume was never the likely trigger;
the artefact is. A server-side dataset of millions of X accounts with signal summaries is a
scrapeable, subpoenable, screenshot-able thing, and the server is an address to send a letter to.
The kill switch covers it (policy off, server drain), but a drained cache is just the local-only
extension with extra steps. The project's current posture, "nothing exists to shut down except a
config file", is a stronger answer to R-01 than any cache design in this document.

The one platform where the calculus flips is Bluesky: the data is public by design, the AppView is
free and CORS-open, a server can verify any contribution against the source of truth, and the
network invites third-party labelers. It is also the platform that needs a cache least, since the
public API already gives every client the same facts. If a shared layer is ever built, Bluesky
first, as a verifier, is the version that teaches the most and risks the least.

## Recommendation

1. **Do Shape A in v1.1** (persisted local cache, seven days, salted-hash keys, size-capped): most of
   the user-visible benefit, no server, one ADR amendment and one privacy-page line.
2. **Do not build Shapes C or D** until there is a second maintainer, a budget for the recurring
   hours in the cost table, and a published dispute and removal process. Record the conditions in
   ADR-0018 so the question is not reopened from scratch.
3. **Prototype Shape B on Bluesky only** if the coordination signals in the evasion analysis prove
   necessary and cannot be computed locally: maintainer-run, verifier-backed, signed shards on the
   existing Pages site, with owner-dispute by DID signature from the first day.
4. **Build the dispute UX now, locally.** The owner-contested cap and the disagreement-lowers-
   confidence rule do not need a server to be designed into the engine; a local "I know this
   account" override that caps at Unsure costs an afternoon and establishes the semantics.
