# ADR-0010: Stack is WXT, TypeScript, Preact, Vitest on pnpm

Status: Accepted
Date: 2026-10-22

## Context

The extension needs: a Manifest V3 build for Chrome and Firefox from one source, hot reload during
development, a MAIN-world content script (ADR-0011), shadow-root-isolated UI injected into hostile host
pages, a popup, an options page and an onboarding page, and a test runner that can exercise both pure
logic and DOM mounting. Bundle size matters because content scripts load on every page view of three
busy sites. Store reviewers read the bundle, so fewer and smaller dependencies mean faster review.

## Decision

- **WXT** for the manifest, entrypoints, multi-browser builds (`.output/chrome-mv3`,
  `.output/firefox-mv3`), `createShadowRootUi` for isolated UI, and `defineContentScript({ world:
  'MAIN' })`.
- **TypeScript** in `strict` mode everywhere, including scripts.
- **Preact** for the badge, hover card, popup, options and onboarding. It is the only runtime
  dependency; policy validation, messaging envelopes and storage access are hand-rolled.
- **Vitest** with the node environment for core logic and a per-file `happy-dom` environment for
  badge-mounting tests; WXT's fake browser for background tests.
- **pnpm** via corepack (Node 24 is already installed; pnpm is not on PATH and is enabled with
  `corepack enable`).
- **Playwright** only in a smoke script outside the CI gate, to load the built extension against saved
  fixture pages and capture PR media.

## Consequences

- One codebase ships Chrome and Firefox; Safari follows via Xcode's converter.
- Preact's small footprint keeps the content-script bundle well under what X or Reddit would notice.
- Contributors need Node 24 and corepack; the README states this.
- Swift-centric conventions from the maintainer's other projects do not apply here; `CONTRIBUTING.md`
  carries the TypeScript equivalents (explicit types on non-obvious `let`/`const`, descriptive names,
  one argument per line on three-plus-argument calls).

## Alternatives considered

- **Plasmo.** Rejected: heavier runtime, less control over the manifest, weaker Firefox story.
- **Plain TypeScript, no framework.** Rejected: hand-rolled DOM for the hover card and three pages
  would cost more than Preact's few kilobytes.
- **React.** Rejected: larger bundle with no benefit at this scale.
