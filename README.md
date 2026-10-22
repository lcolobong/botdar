# Botdar

In-feed badges that show whether a post's author displays patterns common in automated accounts, with a
hover card that explains why. For X, Reddit and Bluesky. Everything runs in your browser; nothing about
the accounts you see leaves it.

Working title. Status: pre-alpha, under construction.

## How it works

Each post author gets a small badge on a three-step scale: looks typical, some automation signals, many
automation signals. Accounts that carry the platform's own automated label show a distinct declared
state. Hovering the badge lists the two to four observations behind it, such as account age, posting
rate, follower ratio and handle shape, plus a line on why the read might be wrong.

Signals come from three tiers of sources, each switchable per platform: what the page renders, what the
page already fetched for itself, and on-demand public profile lookups. A signed configuration file lets
the maintainer turn any tier off for everyone without a store release, and it can only ever restrict.

## Documents

| Document | What it is |
|---|---|
| [docs/product-brief.md](docs/product-brief.md) | Problem, goals, non-goals, scope, success measures |
| [docs/roadmap.md](docs/roadmap.md) | Platforms by release and why |
| [docs/architecture.md](docs/architecture.md) | System design, type contracts, policy system, threat model |
| [docs/scoring-spec.md](docs/scoring-spec.md) | Features, weights, bucketing, wording |
| [docs/design.md](docs/design.md) | Design principles, surfaces, states, copy |
| [docs/decisions/](docs/decisions/) | Architecture decision records |
| [docs/risk-register.md](docs/risk-register.md) | Risks, mitigations, triggers |
| [docs/research/](docs/research/) | Landscape, feasibility, heuristics literature, platform ranking |
| [docs/test-plan.md](docs/test-plan.md) | Automated layers and the manual checklist |
| [docs/release-checklist.md](docs/release-checklist.md) | What to check before shipping |
| [docs/policy-ops.md](docs/policy-ops.md) | Runbook for the kill switch and key rotation |
| [docs/privacy.md](docs/privacy.md) | Source of the published privacy page |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Commit, PR and code rules |

## Stack

WXT, TypeScript, Preact, Vitest, pnpm. Builds for Chrome and Firefox from one codebase.

## License

MIT.
