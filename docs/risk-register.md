# Risk register

Living document. Each risk has an owner, a mitigation that is either built or scheduled, and a concrete
trigger that tells the owner when to act. Review at every release and whenever a trigger fires.
Likelihood and impact are L / M / H. Owner is the maintainer for every entry until the project has more
than one.

| ID | Risk | Likelihood | Impact | Mitigation | Trigger to act | Owner |
|---|---|---|---|---|---|---|
| R-01 | Platform pressure or public backlash from X | M | H | Tiered sources (ADR-0006), signed restrict-only policy (ADR-0007), conservative mode, neutral wording, nothing leaves the browser | Press coverage naming Botdar, a cease-and-desist, or an X staff statement about third-party annotators | maintainer |
| R-02 | ToS breach claims (X scraping clause, Reddit, Truth Social "scripts" wording) | M | M | Local-only processing, no data pooling or resale, Tier 2 rate-limited and hover-only on X and Bluesky (once per author on sight on Reddit, ADR-0020), platform-by-platform legal review before Threads | Any legal correspondence, or a platform publicly enforcing against a comparable extension | maintainer |
| R-03 | False positives and defamation-adjacent harm | H | H | Three tiers not a percentage, two-independent-signal rule for the top tier, reasons and caveat on every card, "This looks wrong" feedback, never "bot" or "fake" (ADR-0003) | Feedback rate above 5% of verdicts in the top tier, a public complaint from a named account, or a journalist flagged in the top tier | maintainer |
| R-04 | GraphQL or DOM schema rotation breaks parsers | H | M | Defensive parsers that yield partials and never throw, fixtures for `core` and `legacy` shapes, runtime queryId discovery, policy-supplied queryId fallback, confidence degrades visibly | CI fixture tests still pass but live verdicts turn mostly `unknown` on a platform; a user report of empty badges | maintainer |
| R-05 | Rate limits and user account locks from Tier 2 lookups | M | H | Token bucket (X 20/min burst 3, Reddit 30/min burst 10, Bluesky 30/min), exponential backoff on `x-rate-limit-reset`, circuit breaker, 24h in-memory cache, hover-only trigger on X and Bluesky; on Reddit one queued lookup per author on sight (ADR-0020) | Any user report of an account lock or captcha loop, or 429 rate above 2% in dev telemetry | maintainer |
| R-06 | Chrome Web Store review rejection (MAIN-world patching, Limited Use, single purpose) | M | M | Justification paragraph in the listing, data-use disclosure, explicit host permissions, no remote code, no `web_accessible_resources` (ADR-0013) | A rejection notice or a request for clarification from review | maintainer |
| R-07 | Firefox data-collection disclosure mismatch | L | L | `data_collection_permissions: { required: ["none"] }` in the manifest, AMO listing text matches | AMO rejection, or any new source that transmits data | maintainer |
| R-08 | Signing-key compromise or loss | L | H | Key only in the password manager, Pages deploy verifies and never signs, `kid` rotation path, last-known-good means loss is not an outage (ADR-0009) | Key material seen anywhere outside the password manager; a policy signed by an unknown `kid` observed | maintainer |
| R-09 | Policy file hosting outage (GitHub Pages) | L | L | Baked defaults, last-known-good cache, daily fetch with jitter, popup shows policy age | Policy age over 14 days on the maintainer's own install | maintainer |
| R-10 | Reddit access changes (`.json` lockdown, March 2027 API shutdown trajectory) | H | M | Reddit Tier 2 is logged-in same-origin only; Tier 0 from the DOM stays; policy switch to drop Tier 2 | `about.json` returns non-JSON or 403 logged-in; Reddit announces web-client changes | maintainer |
| R-11 | Bluesky public AppView rate limiting or CORS change | L | M | Batched `getProfiles` (25 per call), limiter, cache; Tier 1 from feed responses covers `createdAt` and labels alone | 429s or missing `access-control-allow-origin` from `public.api.bsky.app` | maintainer |
| R-12 | Calibration drift over time | H | M | Weights in policy-adjustable JSON, local feedback export, scheduled calibration pass each release, scoring spec records every bin | Feedback "looks wrong" rate rising release over release, or a platform changing default handle formats | maintainer |
| R-13 | Maintainer bus factor | H | M | Public repo, ADRs, runbook in `docs/policy-ops.md`, release checklist, no secrets in the build pipeline except the key | Maintainer unavailable for more than a month with a live incident | maintainer |
| R-14 | Extension fingerprinting by hostile sites | M | M | No `web_accessible_resources`, no page-visible globals from the isolated world, MAIN-world patch leaves no detectable marker beyond the wrapped functions | A platform begins blocking or degrading sessions with Botdar installed | maintainer |
| R-15 | Evasion by operators erodes signal value over time | H | M | Cost-raising behavioural features over cheap-to-fake account attributes, chosen in [adversarial-evasion.md](adversarial-evasion.md) (v1.1 set of six local features); each new feature validated in the calibration pass every release, and the evasion analysis revisited every six months | The share of later-suspended accounts that Botdar read as `typical` rises release over release, or a platform changes default handles, payout rules or the About panel | maintainer |
| R-16 | A shared signal cache, if built, becomes a poisonable, subpoenable list of named accounts and a server to pressure | L (not built) | H | Deferred by [ADR-0018](decisions/ADR-0018-no-shared-cache-yet.md) with three conditions; design in [shared-cache-exploration.md](shared-cache-exploration.md): signals not verdicts, one evidence group, stable-id keys, 30-day expiry, policy off plus server drain, disputes only reduce certainty, owner proof of control, no request logs pairing readers with accounts | Any work starting on Shapes B, C or D; a second maintainer joining; coordination signals proving impossible locally | maintainer |

## R-01 Platform pressure or public backlash from X

This is the risk the maintainer named first. If Botdar gets popular, X could frame it as scraping and
generate pressure to shut it down. The whole tiering and policy design exists to make the answer
"we turned the sensitive parts off within a day" rather than "we resubmitted to the store and waited".
Neutral wording and the local-only model keep the public story simple. The playbook on trigger: flip
X Tier 2 off by policy, assess, then Tier 1 if needed, and say so in the policy notice.

## R-02 ToS breach claims

X's terms forbid scraping "by any means"; Reddit's require consent; Truth Social bans unauthorized
scripts. No precedent was found of X, Reddit, YouTube or TikTok acting against a local in-page
annotator, and comparable X flag extensions have stayed in the store through 2026. Meta is the
exception, which is why Threads is gated behind a legal review and Facebook and Instagram are
deferred. Botdar never pools or sells data, which is the line the BrandTotal and Bright Data rulings
drew.

## R-03 False positives and defamation-adjacent harm

Bot Sentinel was sued for defamation; Pangram flagged the Pope's account. Rauchfleisch and Kaiser found
Botometer precision of 0.59 on real people. Botdar accepts low recall to keep precision high, shows its
reasons, and describes signals rather than people. The feedback button is the early-warning system and
the top-tier feedback rate is tracked per release.

## R-04 Schema rotation

X rotates GraphQL query IDs and has already moved fields from `legacy.*` to `core.*`; new Reddit
ships web components that change; Bluesky's lexicons are versioned but evolve. Parsers must produce
partial signals and let confidence fall, never crash the badge. Fixture recording is a release
checklist item.

## R-05 Rate limits and account locks

Tier 2 traffic is attributable to the user's own account on X and Reddit. The limiter, backoff,
circuit breaker and hover-only trigger keep it well under the documented and observed thresholds, but
X's lock thresholds are undocumented. A single credible lock report triggers a policy change.

Since ADR-0020 Reddit's about.json lookup fires on sight rather than on hover: once per distinct
author within a screen of the viewport, queued behind 30 a minute after a burst of 10, cached for
24 h per tab, and stopped after a logged-out answer. A long thread read top to bottom can sustain
that ceiling. The policy's `rateLimitPerMinute` or `tiers.t2: false` for Reddit is the lever if a
user reports a captcha, a 429 streak or a lock. X stays hover-only for the reasons in R-01.

## R-06 Chrome Web Store review

Reviewers will see a `fetch` patch in a MAIN-world script. The listing explains that it reads only
responses the page already requested, for an allowlist of operations, and that nothing is transmitted.
Everything else about the manifest is deliberately boring.

## R-07 Firefox disclosure

Since November 2025 new Firefox extensions must declare data collection in the manifest. Botdar
declares none. Any future source that transmits data must update the declaration and the listing.

## R-08 Signing key

A compromised key could at worst switch Botdar off, because the policy is restrict-only. A lost key
means no new policies until a rotated public key ships in a release; the last-known-good policy and
baked defaults keep the extension working meanwhile.

## R-09 Policy hosting

GitHub Pages is static and highly available, and the extension does not depend on it to function.
The popup surfaces the policy age so a silent failure is noticed.

## R-10 Reddit access

Reddit blocked unauthenticated `.json` in May 2026 and is ending public Data API access in March 2027.
Botdar relies only on logged-in same-origin requests and the DOM, but Reddit could tighten further.
The DOM path is the floor.

## R-11 Bluesky AppView

The public AppView currently sends CORS `*` with no rate-limit headers. If that changes, Tier 1 from
the web app's own feed responses still supplies `createdAt` and labels, which carry most of the signal.

## R-12 Calibration drift

Handle formats, default avatars and bot tactics change. Weights are data, adjustable by policy without
a release, and every release includes a calibration pass against about 200 live accounts using the
dev-only feature logging.

## R-13 Bus factor

One maintainer. The paper trail in `docs/`, the ADRs and the policy runbook exist so that someone else
could flip a switch or ship a fix. The signing key is the one thing that cannot be reconstructed from
the repo; its location is documented in the runbook without the key itself.

## R-14 Fingerprinting

LinkedIn probes for thousands of extension IDs by loading their web-accessible files. Botdar exposes
none. The MAIN-world patch is detectable in principle by inspecting `window.fetch.toString()`, which is
accepted; the mitigation is not to add any further markers.

## R-15 Evasion by operators

Every v1 feature is an account attribute an operator can buy or set in minutes, and the public weights
give them an exact oracle. The answer is not secrecy but features whose evasion costs throughput or money
(timing, in-thread reuse, account history), validated in each release's calibration pass. The full
analysis and the v1.1 set are in [adversarial-evasion.md](adversarial-evasion.md).

## R-16 Shared signal cache

Not built. The exploration found the hosting bill small and the recurring hours (abuse, data-subject
requests, takedowns, dispute adjudication) large for a solo maintainer, and the dataset itself to be the
artefact most likely to draw pressure. If the ADR-0018 conditions are met, the design in
[shared-cache-exploration.md](shared-cache-exploration.md) is the starting point, Bluesky first.
