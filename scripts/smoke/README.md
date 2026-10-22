# Smoke and media harness

A Playwright script that loads the built Chrome extension and screenshots what a user would see.
It is a local tool for release checks and PR media, not a CI gate: nothing here asserts, and a
missing page or badge is logged and skipped rather than failing the run.

## What it captures

| Group                         | Scenes                                                        | Viewport (CSS px) |
| ----------------------------- | ------------------------------------------------------------- | ----------------- |
| `pages`                       | `popup`, `options`, `onboarding` (each only if in the build)  | 340×470, 720×1010, 640×540 |
| `x`, `reddit`, `bluesky`      | `feed` (badges mounted), `hover` (first badge hovered, 400 ms) | 600×820           |

Every scene is captured at 2x in light and dark. Extension pages get `prefers-color-scheme`
through Playwright's media emulation; feed fixtures additionally get `data-theme` on `<html>`,
which is what the content script reads to pick the badge theme.

Feed fixtures are served over HTTPS under the real hostnames (`x.com`, `www.reddit.com`,
`bsky.app`) by `fixtureServer.ts`, because the extension's host permissions allow nothing else.
Chrome resolves those names to the local server through `--host-resolver-rules` and accepts the
test-only certificate under `cert/` through `--ignore-certificate-errors`. The server prefers a
recorded page under `tests/fixtures/<platform>/html/` and falls back to the placeholder author
rows under `tests/fixtures/smoke/`.

## Running it

```bash
pnpm smoke:setup                 # once per machine: installs Playwright's Chromium
pnpm build                       # the runner never builds
pnpm smoke                       # everything, light and dark, into .output/smoke
pnpm smoke -- --only x --theme dark --out /tmp/botdar-smoke
pnpm smoke -- --headed           # watch it in a window
```

Output is one PNG per scene, named `after-<group>-<scene>-<theme>.png`, and a `manifest.json`
listing each scene with its file, status and the skip reason or fixture kind. The runner exits
non-zero only when Chrome cannot launch or there is no build.

## Using the output for PR media

The file names follow the `pr-media` convention (`after-<scene>.png`, fixed viewport, 2x). For
a commit's test plan, run the harness on the commit's parent with `--out <dir>/c<k>` and rename
those files to `before-…`, run it again on the commit for the `after-…` files, then publish the
folder with `pr-media.sh publish <branch>-c<k> <dir>/c<k>`.
