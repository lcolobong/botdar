# ADR-0013: Minimal permissions, no web-accessible resources, no remote code

Status: Accepted, amended 2026-10-27 (Firefox declares `websiteContent`)
Date: 2026-10-22

## Context

Chrome Web Store review takes longer for broad host permissions and the "single purpose" rule frowns
on anything that looks like it could run anywhere. The LinkedIn research found a concrete hostile
technique: LinkedIn's page script probes for about 6,000 extension IDs by trying to load their bundled
files, which only works when an extension exposes `web_accessible_resources`. X or Reddit could do the
same tomorrow. Separately, the store bans remotely loaded code outright, and Firefox requires add-ons
to be self-contained.

## Decision

- `permissions`: `storage` and `alarms` only.
- `host_permissions`: exactly `https://x.com/*`, `https://twitter.com/*`, `https://www.reddit.com/*`,
  `https://old.reddit.com/*`, `https://bsky.app/*`. New platforms add their own hosts; `<all_urls>` is
  never used. Mastodon, when it arrives, uses optional host permissions requested per server.
- No `web_accessible_resources`. If a future need is unavoidable, use `use_dynamic_url: true` so the
  URL is not a stable fingerprint.
- No remote code of any kind. The policy file (ADR-0007) is data only and is validated against a
  schema before use.
- The public Bluesky AppView and GitHub Pages are reached without host permissions because both send
  `access-control-allow-origin: *`.
- Firefox manifest declares `browser_specific_settings.gecko.data_collection_permissions` with
  `required: ["none"]`.

## Consequences

- Store review has little to object to beyond the MAIN-world patch (ADR-0011), which the listing
  explains.
- MAIN-world scripts must be manifest-registered, which fixes the minimum Firefox version at 128.
- Adding a platform is a manifest change and therefore a store resubmission; this is accepted.

## Alternatives considered

- **`<all_urls>` with runtime matching.** Rejected: slower review, bigger blast radius, worse optics.
- **Injected script via `web_accessible_resources`.** Rejected: fingerprintable.

## Amended 2026-10-27

The Firefox declaration is now `data_collection_permissions: { required: ["websiteContent"] }`, not
`["none"]`. Mozilla's add-on policies count as data transmission any data "collected, used,
transferred, shared, or handled outside of the add-on or the local browser", with no exception for
the site the user is on, and the four Tier 2 lookups send an author's name out of the browser: to
x.com and to the Reddit site in use (same-origin), to `public.api.bsky.app` and to
`hacker-news.firebaseio.com` (neither of them the page). Nothing goes to the developer, so no other
category applies; the reasoning and the Chrome Web Store answers are in `store/README.md`.
`tests/unit/manifest.test.ts` guards the amended invariant on the Firefox build, alongside the
unchanged ones (explicit host permissions, no `web_accessible_resources`).
