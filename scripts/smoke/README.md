# Smoke and media harness

A Playwright script that loads the built Chrome extension and screenshots what a user would see.
It is a local tool for release checks and PR media, not a CI gate: nothing here asserts, and a
missing page or badge is logged and skipped rather than failing the run.

## What it captures

| Group     | Scene      | Page served                              | Expected                                              | Viewport (CSS px) |
| --------- | ---------- | ---------------------------------------- | ----------------------------------------------------- | ----------------- |
| `pages`   | `popup`, `options`, `onboarding` | the extension's own pages (each only if in the build) | | 340×470, 720×1010, 640×540 |
| `x`       | `feed`     | `https://x.com/home` ← `timeline.html`   | Declared bot (kai) and Likely bot (mila) badges       | 600×820           |
| `x`       | `profile`  | `https://x.com/maria_dev` ← `timeline.html` | As `feed`, plus maria_dev's About country and profile timeline; the hover opens her card | 600×820 |
| `reddit`  | `feed`     | `https://www.reddit.com/` ← `feed.html`  | Declared bot badge on the APP-tagged post             | 600×820           |
| `reddit`  | `comments` | thread URL ← `comments.html`             | Likely human on the OP (served profile), No read on the rest | 600×820    |
| `reddit`  | `copied-replies` | thread URL ← `copied-replies.html` (hand-written) | Badges on the two copiers (served two-week-old profiles); the hover opens Bright_Sail_8803's card | 600×820 |
| `bluesky` | `feed`     | `https://bsky.app/` ← `feed.html`        | Declared bot (kai) and Likely bot (mila) badges       | 600×820           |
| `bluesky` | `profile`  | `https://bsky.app/profile/alice.example.com` ← `feed.html` | As `feed`, plus alice's author feed; the hover opens her card | 600×820 |
| `hackernews` | `thread` | `https://news.ycombinator.com/item` ← `thread.html` | Likely human on the OP, Unsure on the first commenter, No read on the rest | 600×820 |
| `hackernews` | `front`  | `https://news.ycombinator.com/` ← `front.html` | Unsure on story 1, Likely human on story 3, No read or Checking on the rest | 600×820 |

Hacker News has a single light theme, so its scenes are worth capturing with `--theme light`; a
dark capture shows the same light badges. Its recordings keep no stylesheet, so the server adds a
short approximation of news.css to the served page.

Every feed scene also has a hover capture (`hover` for the `feed` scene, `<scene>-hover` for the
others) with a badge hovered and the card open. Every scene is captured at 2x in light and dark.
Extension pages get `prefers-color-scheme` through Playwright's media emulation; feed fixtures
additionally get `data-theme` on `<html>`, which is what the content script reads to pick the
badge theme. The scene table lives in `fixtureServer.ts` (`smokeFeedScenes`); a scene that is
expected to draw nothing carries a `note` that the manifest repeats.

Feed fixtures are served over HTTPS under the real hostnames (`x.com`, `www.reddit.com`,
`bsky.app`, `news.ycombinator.com`) by `fixtureServer.ts`, because the extension's host
permissions allow nothing else; `hacker-news.firebaseio.com` is mapped to the same server.
Any `.html` under `tests/fixtures/<platform>/html/` can be served, so a page recorded with
`pnpm capture` (see `scripts/capture/run.ts`) becomes a smoke scene by adding a row to
`smokeFeedScenes` with its `fixtureFile`.
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
| `https://x.com/i/api/graphql/SMOKEQUERYID00000002/AboutAccountQuery` | `tests/fixtures/smoke/x-about-account.json` (hand-written) |
| `https://x.com/i/api/graphql/SMOKEQUERYID00000003/UserTweets` | `tests/fixtures/smoke/x-user-tweets.json` (hand-written) |
| `https://x.com/i/api/graphql/SMOKEQUERYID00000004/UserTweetsAndReplies` | `tests/fixtures/smoke/x-user-tweets-and-replies.json` (hand-written) |
| `https://bsky.app/xrpc/app.bsky.feed.getTimeline`              | `tests/fixtures/bluesky/get-timeline.json`      |
| `https://bsky.app/xrpc/app.bsky.actor.getProfiles`             | `tests/fixtures/bluesky/get-profiles.json`      |
| `https://bsky.app/xrpc/app.bsky.feed.getAuthorFeed`            | `tests/fixtures/smoke/bluesky-author-feed.json` (hand-written) |
| `https://www.reddit.com/user/quiet_lantern_4821/about.json`    | `tests/fixtures/reddit/about/normal.json`       |
| `https://www.reddit.com/user/<name>/about.json` for `quick_fern_2291`, `bright_sail_8803` | `tests/fixtures/smoke/reddit-about-<name>.json` (hand-written) |
| `https://www.reddit.com/user/quiet_lantern_4821/overview.json` | `tests/fixtures/reddit/overview/short.json` (hand-written) |
| `https://hacker-news.firebaseio.com/v0/user/<name>.json` for `tomas_bakes28`, `jonas_draws01`, `priya_draws51` | `tests/fixtures/hackernews/firebase/smoke/<name>.json` |

The Reddit routes answer the extension's own Tier 2 lookups for the recorded thread's OP, matched
on the path alone (the query is ignored); every other author's lookup gets the 404, so the
comments scene shows a profile that was read next to ones that returned nothing. The overview is
asked for on hover only, so it shows in the `comments-hover` capture, where the OP's card gains a
karma-per-day line since the oldest item in the listing (October 2025).

The Hacker News routes answer the Firebase lookup cross-origin, with the
`access-control-allow-origin` the real API sends, from hand-written bodies in the recorded shape:
an account from 2012 with an about text, and two that joined on 2026-10-12 with 700 submissions,
which read Unsure until about 2026-11-11 and drift towards No read after. Every other name gets a
JSON `null`, as an unknown id does on Firebase.

The recorded X and Bluesky pages end with a short script that fetches exactly these URLs on
load (repeated a few times, since the content script subscribes after `document_idle`), so the
extension's MAIN-world interceptor relays the bodies the same way it would on the live sites.
The query id is made up; the interceptor matches any id of the right shape. Account ages in the
bodies are relative to the recording date (2026-10-22), so the Likely bot author drifts towards
"Unsure" as the fixtures age.

The two hand-written X bodies exist because no recording carries them yet: maria_dev's About
lookup (country Brazil) and a profile timeline of 100 Russian-language posts, one about every 110
minutes over seven and a half days. The recorded page fetches them only at the `profile` scene's
path, so the `feed` scene is unchanged; they give her card the observations that need an About
country and a timeline. Replace them with recordings when `pnpm capture` has recorded a profile
visit. The hand-written Bluesky author feed does the same for alice.example.com at the Bluesky
`profile` scene's path: 100 posts, one about every 110 minutes over seven and a half days (the
recorded get-author-feed.json holds a single repost).

The hover scene hovers the badge's button inside its shadow root (the `botdar-badge` host itself
lays out as a block, so hovering it would land on empty row space), preferring a badge named
"Likely bot", then "Unsure", then whichever comes first (a scene with a `hoverAnchor` hovers the
badge after that element instead), and waits up to a second for the
`botdar-card` host to be displayed before the screenshot. The manifest records which badge was
hovered and whether the card opened.

## Running it

```bash
pnpm smoke:setup                 # once per machine: installs Playwright's Chromium
pnpm build                       # the runner never builds
pnpm smoke                       # everything, light and dark, into .output/smoke
pnpm smoke -- --only x --theme dark --out /tmp/botdar-smoke
pnpm smoke -- --headed           # watch it in a window
pnpm smoke -- --only store --viewport 1280x800 --out store/screenshots   # the Chrome Web Store set
```

`--viewport <width>x<height>` captures at that CSS size and device scale 1 (the default is 600x820
at 2x). `--only store` is opt-in and needs it: it writes the five numbered listing screenshots
from `storeScenes.ts` (plus `popup-alone.png`, the unpadded popup), light except the Bluesky one.

Output is one PNG per scene, named `after-<group>-<scene>-<theme>.png`, and a `manifest.json`
listing each scene with its file, status, the served fixture, the badge hovered, the scene's
note and any reason (a skip, a bare feed, or a card captured as a full page). The runner exits
non-zero only when Chrome cannot launch or there is no build.

## Using the output for PR media

The file names follow the `pr-media` convention (`after-<scene>.png`, fixed viewport, 2x). For
a commit's test plan, run the harness on the commit's parent with `--out <dir>/c<k>` and rename
those files to `before-…`, run it again on the commit for the `after-…` files, then publish the
folder with `pr-media.sh publish <branch>-c<k> <dir>/c<k>`.
