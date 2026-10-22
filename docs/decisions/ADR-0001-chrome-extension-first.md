# ADR-0001: Chrome extension first, iOS later as a Safari Web Extension

Status: Accepted
Date: 2026-10-22

## Context

The product idea was "a Chrome plugin and/or an iOS app" that badges accounts in-feed. The feasibility
research (docs/research/feasibility.md) established that iOS offers no API for injecting into or
overlaying another app's UI, so nothing can annotate inside the native X, Reddit, Instagram or TikTok
apps. The only iOS shapes available are a Safari Web Extension packaged inside an App Store app, or a
share-sheet "check this profile" app that would need a server-side data source. App Review guidelines
5.1.1(viii) (compiling personal information from third-party sources) and 5.2.2 (using third-party
content without permission) make the server-backed lookup app the most exposed option.

A Chrome Manifest V3 extension can read the rendered page and the page's own network responses, badge
in place, and ship on the Chrome Web Store with a review cycle measured in days. WXT builds Firefox from
the same source, and Xcode's `safari-web-extension-converter` can wrap the same bundle for iOS later.

## Decision

Ship Botdar as a Chrome extension first, with Firefox from the same build. Treat iOS as a later phase
delivered as a Safari Web Extension that reuses the TypeScript scoring core unchanged. Do not build a
native share-sheet lookup app.

## Consequences

- The in-feed experience is desktop-web only at launch. Mobile users of the native apps get nothing.
- The core (`src/core`) must stay free of Chrome-only APIs so it ports to Safari without edits.
- Background logic must be written as a non-persistent service worker, which Safari on iOS requires.
- The App Store wrapper, Apple developer account, and a per-site consent flow are deferred work.

## Alternatives considered

- **iOS app first.** Rejected: no in-feed annotation is possible, and a server-backed lookup app runs
  straight into App Review 5.1.1(viii) and 5.2.2.
- **Both in parallel.** Rejected: slower to a first ship with no benefit, since the Safari build is a
  wrapper around the same bundle and can follow once the extension is stable.
