# Smoke and media harness

A Playwright script that loads the built Chrome extension and screenshots what a user would see.
It is a local tool for release checks and PR media, not a CI gate: nothing here asserts, and a
missing page or badge is logged and skipped rather than failing the run.

## What it captures

| Group     | Scene      | Page served                              | Expected                                              | Viewport (CSS px) |
| --------- | ---------- | ---------------------------------------- | ----------------------------------------------------- | ----------------- |
| `pages`   | `popup`, `options`, `onboarding` | the extension's own pages (each only if in the build) | | 340×470, 720×1010, 640×540 |
| `x`       | `feed`     | `https://x.com/home` ← `timeline.html`   | Declared bot (kai) and Likely bot (mila) badges       | 600×820           |
| `reddit`  | `feed`     | `https://www.reddit.com/` ← `feed.html`  | Declared bot badge on the APP-tagged post             | 600×820           |
| `reddit`  | `comments` | thread URL ← `comments.html`             | quiet feed: every author scores typical, no badge     | 600×820           |
| `bluesky` | `feed`     | `https://bsky.app/` ← `feed.html`        | Declared bot (kai) and Likely bot (mila) badges       | 600×820           |

Every feed scene also has a hover capture (`hover` for the `feed` scene, `<scene>-hover` for the
others) with a badge hovered and the card open. Every scene is captured at 2x in light and dark.
Extension pages get `prefers-color-scheme` through Playwright's media emulation; feed fixtures
additionally get `data-theme` on `<html>`, which is what the content script reads to pick the
badge theme. The scene table lives in `fixtureServer.ts` (`smokeFeedScenes`); a scene that is
expected to draw nothing carries a `note` that the manifest repeats.

Feed fixtures are served over HTTPS under the real hostnames (`x.com`, `www.reddit.com`,
`bsky.app`) by `fixtureServer.ts`, because the extension's host permissions allow nothing else.
Chrome resolves those names to the local server through `--host-resolver-rules` and accepts the
test-only certificate under `cert/` through `--ignore-certificate-errors`. A scene names its
recorded page under `tests/fixtures/<platform>/html/`; otherwise the server prefers `feed.html`,
then `timeline.html`, then the first file, and falls back to the placeholder author rows under
`tests/fixtures/smoke/`. The manifest names the file each scene was served.

### API fixture routes

So that Tier 1 scoring runs in the captures, the server also answers the API requests the web
apps make with recorded bodies (`apiFixtureRoutes` in `fixtureServer.ts`), for GET or POST, and
returns 404 for every other API path:

| Request                                                        | Body                                            |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `https://x.com/i/api/graphql/SMOKEQUERYID00000001/HomeTimeline` | `tests/fixtures/x/graphql/home-timeline-core.json` |
| `https://bsky.app/xrpc/app.bsky.feed.getTimeline`              | `tests/fixtures/bluesky/get-timeline.json`      |
| `https://bsky.app/xrpc/app.bsky.actor.getProfiles`             | `tests/fixtures/bluesky/get-profiles.json`      |

The recorded X and Bluesky pages end with a short script that fetches exactly these URLs on
load (repeated a few times, since the content script subscribes after `document_idle`), so the
extension's MAIN-world interceptor relays the bodies the same way it would on the live sites.
The query id is made up; the interceptor matches any id of the right shape. Account ages in the
bodies are relative to the recording date (2026-10-22), so the Likely bot author drifts towards
"Unsure" as the fixtures age.

The hover scene hovers the badge's button inside its shadow root (the `botdar-badge` host itself
lays out as a block, so hovering it would land on empty row space), preferring a badge named
"Likely bot", then "Unsure", then whichever comes first, and waits up to a second for the
`botdar-card` host to be displayed before the screenshot. The manifest records which badge was
hovered and whether the card opened.

## Running it

```bash
pnpm smoke:setup                 # once per machine: installs Playwright's Chromium
pnpm build                       # the runner never builds
pnpm smoke                       # everything, light and dark, into .output/smoke
pnpm smoke -- --only x --theme dark --out /tmp/botdar-smoke
pnpm smoke -- --headed           # watch it in a window
```

Output is one PNG per scene, named `after-<group>-<scene>-<theme>.png`, and a `manifest.json`
listing each scene with its file, status, the served fixture, the badge hovered, the scene's
note and any reason (a skip, a bare feed, or a card captured as a full page). The runner exits
non-zero only when Chrome cannot launch or there is no build.

## Using the output for PR media

The file names follow the `pr-media` convention (`after-<scene>.png`, fixed viewport, 2x). For
a commit's test plan, run the harness on the commit's parent with `--out <dir>/c<k>` and rename
those files to `before-…`, run it again on the commit for the `after-…` files, then publish the
folder with `pr-media.sh publish <branch>-c<k> <dir>/c<k>`.
