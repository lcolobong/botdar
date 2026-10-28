# Botdar

In-feed badges that show whether a post's author displays patterns common in automated accounts, with a
hover card that explains why. For X, Reddit, Bluesky, Hacker News and YouTube comments. Everything runs in your browser; nothing about
the accounts you see leaves it.

Working title. Status: pre-alpha, under construction.

## What it does

On X, Reddit, Bluesky, Hacker News and YouTube comments, Botdar draws a small badge next to the author of every post: "Likely bot"
when several independent signals common in automated accounts agree, "Unsure" when only one or two
do, "Declared bot" when the platform's own automated label is set, "Likely human" when enough is
visible and nothing stands out, and "No read" when there is too little to go on ("Checking" while
the profile is still loading). Hovering a badge lists the two to four observations behind it, such as
account age, posting rate, follower ratio and karma, each with a number or a date, and every card
that gives a read ends with a line that says how far to trust it. Botdar describes patterns, not people; it never hides a post, and
it makes no claim about how often its badges are right.

## Install from source

Requires Node 24 and pnpm (`corepack enable` picks up the pinned version).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` writes a development build to `.output/chrome-mv3` and rebuilds on change. In Chrome, open
`chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick `.output/chrome-mv3`.
For Firefox, `pnpm dev:firefox` writes `.output/firefox-mv2`, which loads from `about:debugging` as a
temporary add-on. `pnpm build` and `pnpm build:firefox` produce the release builds; `pnpm zip` and
`pnpm zip:firefox` package them.

## How scoring works

Each platform adapter turns what it can see about an author into a short list of features, such as
account age, posting rate, follower ratio and handle shape, and a feature is left out entirely when its
gate is not met, so a ratio over tiny counts cannot dominate ([scoring-spec.md](docs/scoring-spec.md)).
Features come from three tiers of sources, each switchable per platform: what the page renders, what the
page already fetched for itself, and on-demand public profile lookups
([architecture.md](docs/architecture.md), [ADR-0006](docs/decisions/ADR-0006-tiered-signal-sources.md)).
Each feature contributes a capped, hand-set weight, groups of related features share a cap, and the sum
goes through a logistic function to give an internal probability that is never shown to users
([ADR-0004](docs/decisions/ADR-0004-heuristics-not-trained-model.md)). The "Likely bot" tier requires
that probability to clear its threshold, at least two strong signals from distinct groups, and
confidence of at least 0.5, where confidence measures how many source tiers actually delivered; when
fewer than half did, the tier is capped at "Unsure" and the badge renders hollow
([ADR-0003](docs/decisions/ADR-0003-three-tier-verdict.md),
[ADR-0017](docs/decisions/ADR-0017-badge-wording-and-label-styles.md)). The reasons on the card are the
strongest contributions rendered through fixed templates, negative evidence included, and the caveat is
chosen by the group of the largest positive contribution ([design.md](docs/design.md)).

## The policy kill switch

Once a day the extension downloads a signed policy file from
[lcolobong.github.io/botdar/policy/v1.json](https://lcolobong.github.io/botdar/policy/v1.json), verifies
it against a public key built into the package, and merges it over the build defaults. The merge is
restrict-only: a policy can switch a platform or a signal source off for everyone, lower a cap, raise a
threshold or show a one-time notice, and it can never enable anything, raise a cap or run code, so a
stolen key or a hijacked host can only ever turn features off. The procedure for flipping a switch and
rotating the key is in [policy-ops.md](docs/policy-ops.md), and the design rationale in
[ADR-0007](docs/decisions/ADR-0007-signed-restrict-only-policy.md).

## Privacy

Nothing is sent to us, and there is no Botdar server. To read an author's public profile the
extension asks the platform the post is on (x.com, reddit.com, Bluesky's public API, the Hacker News
API), naming that author; conservative mode turns these lookups off. The daily policy fetch carries no
information about you. Settings, the last policy file and
any "This looks wrong" feedback you record stay in local storage; account signals live in memory for the
open tab and are discarded when it closes. The full text is in [privacy.md](docs/privacy.md) and
published at [lcolobong.github.io/botdar/privacy.html](https://lcolobong.github.io/botdar/privacy.html).

## Documents

| Document                                                     | What it is                                              |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| [docs/product-brief.md](docs/product-brief.md)               | Problem, goals, non-goals, scope, success measures      |
| [docs/roadmap.md](docs/roadmap.md)                           | Platforms by release and why                            |
| [docs/architecture.md](docs/architecture.md)                 | System design, type contracts, policy system, threat model |
| [docs/scoring-spec.md](docs/scoring-spec.md)                 | Features, weights, bucketing, wording                   |
| [docs/design.md](docs/design.md)                             | Design principles, surfaces, states, copy               |
| [docs/decisions/](docs/decisions/)                           | Architecture decision records                           |
| [docs/risk-register.md](docs/risk-register.md)               | Risks, mitigations, triggers                            |
| [docs/research/](docs/research/)                             | Landscape, feasibility, heuristics literature, platform ranking |
| [docs/test-plan.md](docs/test-plan.md)                       | Automated layers and the manual checklist               |
| [docs/release-checklist.md](docs/release-checklist.md)       | What to check before shipping                           |
| [docs/policy-ops.md](docs/policy-ops.md)                     | Runbook for the kill switch and key rotation            |
| [docs/privacy.md](docs/privacy.md)                           | Source of the published privacy page                    |
| [store/README.md](store/README.md)                           | Store listing and disclosure texts                      |
| [CHANGELOG.md](CHANGELOG.md)                                 | User-facing changes per release                         |
| [CONTRIBUTING.md](CONTRIBUTING.md)                           | Commit, PR and code rules                               |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: one logical change per commit, each one green on its
own, stacked PRs merged with rebase, and `docs/` updated in the same PR as any behaviour change.

## Stack

WXT, TypeScript, Preact, Vitest, pnpm. Builds for Chrome and Firefox from one codebase.

## License

MIT. See [LICENSE](LICENSE).
