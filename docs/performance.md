# Page performance

Baseline measurements of what the content scripts cost a page, recorded on 2026-10-22 from the
`perf` branch (extension build of `[3/4][Perf] Add the performance benchmark runner`), with the
hotspots behind those numbers and the fixes worth making, ranked by payoff. Nothing in `src/` was
changed for this document.

The target is "next to no impact; badges lazy-load as analysis finishes".

## Method

**Fixtures.** `pnpm perf:fixtures` (scripts/perf/generateFixtures.ts) writes four large, seeded
feeds under `tests/fixtures/perf/`, each item in the markup shape of the hand-written fixtures the
unit tests use:

| Fixture                     | Items                                                                 | Expected badges                       |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| `reddit-feed-300.html`      | 300 `shreddit-post` with declarative shadow roots, both author-row shapes | 30 APP-tagged → Declared bot        |
| `reddit-comments-1500.html` | 1 post + 1,500 `shreddit-comment`, nested to depth 6                  | 30 APP-tagged → Declared bot, plus a few Unsure |
| `x-timeline-400.html`       | 400 `article[data-testid="tweet"]` + a HomeTimeline body with 400 users | 20 Automated → Declared, 20 Likely bot (Tier 1) |
| `bluesky-feed-300.html`     | 300 feed items, Tier 0 only (no API body)                              | 15 robot-badged → Declared bot        |

**Runner.** `pnpm perf -- --out <dir>` (scripts/perf/run.ts, measure.ts) reuses the smoke
harness: the fixture server answers for `www.reddit.com`, `x.com` and `bsky.app` through
`--host-resolver-rules`, and the X page fetches its HomeTimeline body at load, +0.5 s and +1.5 s
so the MAIN-world interceptor relays it to Tier 1. Two Chrome for Testing instances run side by
side, one with the built extension and one bare, both 1280×800 at 2x. Each fixture gets one
unrecorded warm-up per browser, then five runs per condition, alternating extension and bare.
Every number below is the median of the five.

Per run:

- **DOMContentLoaded / load**: Navigation Timing, from navigation start.
- **Long tasks / Total Blocking Time**: a `longtask` PerformanceObserver installed with
  `page.addInitScript`; TBT is Σ(duration − 50 ms) over long tasks from navigation start until
  the run settles.
- **Script / task / layout / style time**: CDP `Performance.getMetrics` (`ScriptDuration`,
  `TaskDuration`, `LayoutDuration`, `RecalcStyleDuration`) for the renderer, read at settle. The
  content scripts run on the same main thread and isolate as the page, so they are included.
- **JS heap**: `JSHeapUsedSize` after settle and a forced GC.
- **First / last badge**: the probe polls the `botdar-badge` count every 50 ms (including badges
  inside Reddit posts' shadow roots); times are relative to `loadEventEnd` (negative means the
  badge mounted before `load`). A run settles when the count has held for 1 s and at least
  2.5 s have passed since load (past the X page's last fetch).
- **Scroll**: ten `scrollTo` steps to the bottom with 300 ms pauses; long tasks and blocking time
  in that window, and the longest gap between `requestAnimationFrame` callbacks in each step.
- **Live insertion** (Reddit feed only): 50 more posts appended to `shreddit-feed` with
  `setHTMLUnsafe` (so their declarative shadow roots parse) after the scroll; time to the first
  and last new badge and the long tasks in between.

Everything ran twice: at this machine's speed and with CDP CPU throttling at 4x
(`--cpu-throttle 4`) as a stand-in for a mid-range laptop. A CPU profile of each fixture
(`--profile`, one extra 4x run of an unminified build, 100 µs sampling from navigation to settle)
names the functions; the hotspot section quotes it.

Machine: Apple M5 Pro (18 cores, 64 GB), macOS 26 (Darwin 25.6.0), Chrome for Testing
156.0.8078.4 in new headless mode, Playwright 1.64.1.

## Results

### At full speed (1x)

| Fixture              | Condition | load (ms) | TBT (ms) | Script (ms) | Heap (MB) | First badge (ms) | Last badge (ms) | Badges | Scroll long tasks |
| -------------------- | --------- | --------: | -------: | ----------: | --------: | ---------------: | --------------: | -----: | ----------------: |
| reddit-feed-300      | bare      |      37.4 |        0 |         9.1 |       0.8 |                – |               – |      0 |                 0 |
| reddit-feed-300      | extension |      45.6 |        0 |        24.5 |       2.2 |               64 |              64 |     30 |                 0 |
| reddit-feed-300      | **delta** |  **+8.2** |    **0** |   **+15.4** |  **+1.4** |                  |                 |        |             **0** |
| reddit-comments-1500 | bare      |      37.5 |        0 |        42.1 |       0.8 |                – |               – |      0 |                 0 |
| reddit-comments-1500 | extension |      73.7 |        0 |        74.5 |       4.0 |               39 |              39 |     37 |                 0 |
| reddit-comments-1500 | **delta** | **+36.2** |    **0** |   **+32.3** |  **+3.2** |                  |                 |        |             **0** |
| x-timeline-400       | bare      |      62.7 |        0 |        18.4 |       0.7 |                – |               – |      0 |                 0 |
| x-timeline-400       | extension |      73.4 |        0 |        50.2 |       3.1 |               39 |             539 |     40 |                 0 |
| x-timeline-400       | **delta** | **+10.7** |    **0** |   **+31.8** |  **+2.4** |                  |                 |        |             **0** |
| bluesky-feed-300     | bare      |      46.8 |        0 |         5.7 |       0.7 |                – |               – |      0 |                 0 |
| bluesky-feed-300     | extension |      57.7 |        0 |        13.9 |       2.1 |               10 |              10 |     15 |                 0 |
| bluesky-feed-300     | **delta** | **+10.9** |    **0** |    **+8.2** |  **+1.4** |                  |                 |        |             **0** |

Also at 1x: DOMContentLoaded moved by at most ±2 ms on every fixture; all-tasks time grew by
24–50 ms, layout by 1.4–4.1 ms and style recalc by at most 1.2 ms. Inserting 50 Reddit posts
mounted their 6 new badges 19 ms after insertion, in one batch, with no long task. The X feed's
last badge (539 ms) is the Likely bot verdicts arriving with the second timeline fetch at
+0.5 s, which is the intended lazy path: Tier 0 badges first, Tier 1 badges when the page's own
response lands.

### With 4x CPU throttling

| Fixture              | Condition | load (ms) | TBT (ms) | Script (ms) | Heap (MB) | First badge (ms) | Last badge (ms) | Badges | Scroll long tasks |
| -------------------- | --------- | --------: | -------: | ----------: | --------: | ---------------: | --------------: | -----: | ----------------: |
| reddit-feed-300      | bare      |       128 |        0 |        14.8 |       0.8 |                – |               – |      0 |                 0 |
| reddit-feed-300      | extension |       167 |        0 |        72.5 |       2.2 |               79 |              79 |     30 |                 0 |
| reddit-feed-300      | **delta** | **+38.5** |    **0** |   **+57.8** |  **+1.4** |                  |                 |        |             **0** |
| reddit-comments-1500 | bare      |       277 |        0 |         110 |       0.8 |                – |               – |      0 |                 0 |
| reddit-comments-1500 | extension |       321 |       44 |         231 |       4.0 |              145 |             145 |     37 |                 0 |
| reddit-comments-1500 | **delta** | **+44.2** |  **+44** |    **+121** |  **+3.1** |                  |                 |        |             **0** |
| x-timeline-400       | bare      |       216 |        0 |        39.1 |       0.7 |                – |               – |      0 |                 0 |
| x-timeline-400       | extension |       270 |        0 |         176 |       3.1 |              124 |             124 |     40 |                 0 |
| x-timeline-400       | **delta** | **+53.3** |    **0** |    **+137** |  **+2.4** |                  |                 |        |             **0** |
| bluesky-feed-300     | bare      |       112 |        0 |         6.6 |       0.7 |                – |               – |      0 |                 0 |
| bluesky-feed-300     | extension |       159 |        0 |        42.3 |       2.1 |               67 |              67 |     15 |                 0 |
| bluesky-feed-300     | **delta** | **+47.8** |    **0** |   **+35.8** |  **+1.4** |                  |                 |        |             **0** |

The 1,500-comment thread produced exactly one long task in every throttled run (TBT 41–45 ms,
so the task is about 94 ms): the observer's first pass over the whole thread. Two of five
throttled X runs had one long task (1 ms and 12 ms of blocking); the median is 0. Inserting 50
Reddit posts mounted their badges after 44 ms with no long task. At 4x the X content script
subscribed late enough that the first timeline fetch already carried Tier 1, so all 40 badges
landed together.

Scrolling never produced a long task, and the longest gap between animation frames was
16.7–16.8 ms in every step of every run, bare or not: the extension does no work while
scrolling (no scroll listener, no IntersectionObserver), so there is nothing for it to drop.

Raw runs, per-step frame gaps and the full per-fixture tables are in `results.json` and
`results.md` from `pnpm perf`; they are not committed.

## Verdict

**On this machine the target holds.** Across all four fixtures at full speed the extension adds
no long task, no blocking time and no dropped frames while scrolling; it costs 8–32 ms of script
and 1.4–3.2 MB of heap per page, and the first badges mount 10–64 ms after `load`, with Tier 1
verdicts following when the page's own API responses arrive. DOMContentLoaded does not move.

**On a slower machine it mostly holds, with one exception.** At 4x the feeds still produce no
blocking time, but the 1,500-comment thread hits one ~94 ms long task (TBT +44 ms) because the
first pass analyses every comment in one go. Script cost grows to 36–137 ms per page load.

**"Badges lazy-load as analysis finishes" is only half true.** Badges are not on the critical
path (DOMContentLoaded is unaffected, Tier 1 badges arrive later without blocking), but the
analysis itself is not lazy: every post in the document is extracted and scored in a single
idle-callback pass whatever its distance from the viewport, and the pass ignores the idle
deadline. That is what produces the long task above, and it is what would scale badly on a live
thread with thousands of comments.

The `load` event moves by 8–36 ms (38–53 ms at 4x) because Chrome can inject `document_idle`
content scripts before `load` fires on a fast-parsing page, so their evaluation (about 7 ms at
1x, 27–31 ms at 4x, per the profiles) and the first pass delay it. DOMContentLoaded and the
parse are unaffected; paint timing was not measured, but analytics that key off `load` would
see the shift.

## Hotspots

From the code and the 4x CPU profiles (unminified build; totals are inclusive of callees).
"Verified" marks a claim checked in the profile or the code, not inferred.

| Profile (4x)         | Extension self time | Biggest inclusive entries                                                                                 |
| -------------------- | ------------------: | --------------------------------------------------------------------------------------------------------- |
| reddit-comments-1500 |            126.5 ms | `runPass` 88.9 → `toPostRef` 36.1, `hasAppTag` 35.9 (two calls per comment), `extractDomSignals` 22.2, `createMountedUi` 16.7, `metaRowsOf` 13.5, `recompute` 11.5; bundle evaluation 28.8 |
| reddit-feed-300      |             70.8 ms | bundle evaluation 30.8; `runPass` 27.4 → `attach` 14.9, `createMountedUi` 13.5, `toPostRef` 7.1          |
| x-timeline-400       |            163.7 ms | relay `listener` 63.3 → `recompute` 50.3 (Tier 1 rescoring); `pass` 42.7; bundle 30.9; `toFeatures` 22.9 (`regionFromNavigatorLanguage` 8.7 self); `renderReason` 10.0; `createMountedUi` 15.0; MAIN-world `relay` 11.0 |
| bluesky-feed-300     |             82.0 ms | bundle 31.0; `attach` 23.1; `displayNameOf` 13.4                                                          |

1. **Reddit Tier 0 walks every element of the author row and shadow root, twice per item.**
   `hasAppTag` (src/platforms/reddit/dom.ts:104–111) runs `querySelectorAll("*")` over each meta
   row and over the host's whole shadow root and reads `textContent` of every leaf looking for
   "APP". It runs in `toPostRef` (dom.ts:147) and again in `extractDomSignals` (dom.ts:161) for
   every item that is not tagged, which is 90–98% of them. `metaRowsOf` (dom.ts:71–79) is
   rebuilt by `findAuthorAnchor`, both `hasAppTag` calls and `hasDefaultAvatar`, up to four times
   per item. Verified: 35.9 ms of the 88.9 ms comment pass is `hasAppTag`, 13.5 ms more is
   `metaRowsOf`. Live Reddit shadow roots are much larger than the fixture's, so this is the
   cost most likely to be worse in the wild.
2. **One unbounded pass per idle callback.** `runPass` (src/platforms/reddit/observer.ts:64–80),
   X's `pass` (src/platforms/x/observer.ts:40–59) and Bluesky's `scan`
   (src/platforms/bluesky/observer.ts:44–65) process every pending item in one task. They are
   scheduled with `requestIdleCallback(..., { timeout: 150 })` (`IDLE_TIMEOUT_MS`,
   reddit/observer.ts:21; `PASS_DELAY_MS`, x/observer.ts:19) but never read the
   `IdleDeadline`, and on a busy page the 150 ms timeout turns the pass into an ordinary task.
   Verified: this is the ~94 ms long task on the throttled comment thread. The 150 ms fallback
   itself is not the problem (first badges land well inside it); the missing work cap is.
3. **Tier 1 relays redo work on every body.** For each intercepted GraphQL response the MAIN
   world parses the text (src/platforms/x/interceptor.main.ts:48), `postMessage` structured-clones
   the parsed object, the isolated world re-serialises it with `JSON.stringify` only to check its
   size (src/core/relay.ts:50–57, called at relay.ts:90), and `collectUsers` walks it.
   `AccountResolver.absorb` (src/core/pipeline.ts:311–319) then rescores every on-screen author in
   the body even when `mergeSignals` reported no change, and every rescore re-renders the badge.
   Inside each rescore, X's `toFeatures` evaluates `regionFromNavigatorLanguage()` as a default
   parameter (src/platforms/x/features.ts:40–51, 83), constructing an `Intl.Locale` per call, and
   `evidenceFor` renders a reason string for every evidence item although the card shows only the
   selected few (src/core/scoring/engine.ts:78–88). Verified: 63.3 ms inclusive in the relay
   listener for three relays of a 300 KB body, 8.7 ms self in `regionFromNavigatorLanguage`,
   10.0 ms in `renderReason`; two of the three relays changed nothing.
4. **Per-badge shadow root with its own copy of every stylesheet.** `createMountedUi`
   (src/ui/mount.ts:149–181) goes through WXT's `createShadowRootUi`, which per badge awaits
   `createIsolatedElement`, regex-splits the CSS, and appends a `<style>` carrying the whole
   ~7.4 KB of `tokens.css` + `badge.css` + `card.css` (`shadowStyles`, mount.ts:159; the card
   rules are dead weight in a badge). Blink shares the parsed sheet for identical text, so the
   cost is mostly per-root style scoping and the async chain: verified 13.5–16.7 ms inclusive for
   30–40 badges at 4x (about 0.4 ms each), plus 3–4 ms of extra layout at 1x.
5. **Badges retain their posts after removal (memory).** WXT's `createShadowRootUi` registers
   `ctx.onInvalidated(remove)` for every UI and drops the returned unsubscribe
   (node_modules/wxt/dist/utils/content-script-ui/shadow-root.mjs; `onInvalidated` adds an
   `abort` listener on the context's signal). Each `remove` closure holds the shadow host and the
   options object with the `anchor`, so every badge ever mounted keeps its anchor, and with it the
   detached post subtree, alive until the page unloads, even after `unmountBadge`. On X, which
   virtualises its timeline, that grows without bound over a long session. Verified in the code;
   the fixtures do not virtualise, so the benchmark cannot show it.
6. **X and Bluesky rescan the whole document on every mutation batch.** `findUnbadgedPosts`
   (src/platforms/x/dom.ts:27–29) and Bluesky's `root.querySelectorAll(UNMARKED_POST_SELECTOR)`
   (bluesky/observer.ts:55) match every post in the document on each pass, and posts that drew no
   badge (typical and unknown, about 90%) are never marked, so they are re-matched and looked up
   in `tracked` each time. Any childList mutation anywhere under `body` schedules a pass,
   including the badge insertions themselves. Reddit already does this right: after the first
   full scan it only searches `addedNodes` subtrees (reddit/observer.ts:73–79). On the static
   fixture this is small (X `pass` is 42.7 ms inclusive at 4x, mostly `attach`); on live X, where
   React and timestamp updates mutate the tree continuously, it is a steady idle-time cost
   proportional to the posts kept in the DOM.
7. **Smaller per-item costs.** Bluesky's `displayNameOf` builds a new escaped `RegExp` per post
   (src/platforms/bluesky/dom.ts:118–119; 13.4 ms at 4x). X's `toPostRef` scans every `span` of
   the article twice, once for "Replying to" and once for "Automated", each with a `closest()`
   (src/platforms/x/dom.ts:61–71, 84, 87). Bundle evaluation is 27–31 ms per page at 4x
   (7–8 ms at 1x), which includes evaluating Preact, the WXT runtime, the weights and possibly
   the 25 KB bigram table (src/core/handle/bigrams.json); the profile does not split it further.
8. **Map growth is bounded but linear in the page.** `AccountResolver` caps tracked accounts at
   2,000 (`MAX_TRACKED_ACCOUNTS`, src/core/pipeline.ts:33) and evicts idle ones in batches of 200
   (pipeline.ts:361–370), which is fine. The per-post maps (`attachedPosts`, X's `states`,
   Reddit's `slots`) only shrink when posts leave the DOM, and Reddit never removes them, so they
   grow with scroll depth. Measured: about 1.5 KB of heap per extra Reddit item
   (the comment thread's +3.2 MB against the feed's +1.4 MB, over 1,200 more items), on top of
   about 1.4 MB fixed.

**Verified non-issue: typical and unknown verdicts never mount a badge.** `shouldDrawBadge`
(src/ui/labels.ts) returns false for `unknown`, and for `typical` unless "Show Likely human" is
on; the X wiring's `drawableTier`/`sync` (src/platforms/x/wire.ts:80–83, 155–166) and Reddit's
`syncBadge` (src/platforms/reddit/wire.ts:262–266) skip the mount. Those posts are still
extracted and scored in full, which is where hotspots 1, 2 and 6 come from.

## Proposed fixes, ranked by payoff

Estimates are for the fixtures at 4x unless stated; "per item" figures scale with feed size.

| # | Fix | Where | Estimated gain |
| --- | --- | --- | --- |
| 1 | **Do Reddit Tier 0 in one pass per item.** Collect the meta rows once, search for the APP tag only among the author row's own leaves (not the whole shadow root), stop at the first match, and carry the result from `toPostRef` into `extractDomSignals` instead of re-scanning. | reddit/dom.ts:71–167 | About 40–45 ms of the 89 ms comment pass (≈ 50%), roughly 10 ms at 1x on 1,500 comments; removes most of the long task on its own. Larger on live Reddit, whose shadow roots are bigger. |
| 2 | **Cap work per idle slice.** Keep a queue; process items while `deadline.timeRemaining() > 2 ms` (or for at most ~8 ms when the 150 ms timeout fired), then reschedule the rest. Same change in all three observers. | reddit/observer.ts:64–91, x/observer.ts:40–69, bluesky/observer.ts:44–82 | Turns the ~94 ms task into slices under 50 ms: TBT on the comment thread +44 ms → 0. Total CPU unchanged; last badge a few frames later. |
| 3 | **Score lazily near the viewport.** Discover posts as today, but extract, score and mount only when an IntersectionObserver (rootMargin ≈ one or two viewports) reports them close; Tier 1 emissions keep merging into the resolver cheaply. | the three wire/observer pairs | Initial pass from O(feed) to O(viewport): on the comment thread ~89 ms → ~10 ms at 4x, spread the rest over scrolling. Highest ceiling, but the biggest change; fixes 1 and 2 first. |
| 4 | **Make Tier 1 relays cheap and change-aware.** Relay the response text instead of the parsed object (size check becomes `text.length`, one `JSON.parse` in the isolated world, no structured clone of an object graph); skip `recompute` in `absorb` when `mergeSignals` returned false and no new tier was added; compute the locale region once per page; render reason strings only for the selected reasons. | interceptor.main.ts:43–53, relay.ts:50–93, pipeline.ts:311–319, x/features.ts:40–83, scoring/engine.ts:78–88 | About 60–70 ms of the 137 ms X delta at 4x (≈ 45%): ~2/3 of Tier 1 rescoring on repeated bodies, one serialise and one clone per relay, 8.7 ms locale, ~7 ms reasons. Grows with real HomeTimeline bodies (1–2 MB). |
| 5 | **Own a lightweight badge mount.** Create the host and open shadow root directly, share one constructed `CSSStyleSheet` (badge rules only; the card keeps its own) via `adoptedStyleSheets`, mount synchronously, and batch inserts per animation frame. | ui/mount.ts:149–230 | About 10 ms per 40 badges at 4x plus a few ms of layout; ~7 KB less DOM per badge. Also removes hotspot 5 (see 6). |
| 6 | **Stop retaining removed badges.** With fix 5, register one `ctx.onInvalidated` for all badges; without it, keep WXT's UI but unregister on removal (e.g. track live UIs in a Set and remove them on invalidation). | ui/mount.ts:149–198 | Memory, not CPU: on a virtualised X session, every badge-carrying tweet scrolled past stops leaking its detached subtree (likely tens of KB per tweet on live X; not measured). |
| 7 | **Scan only added subtrees on X and Bluesky,** as Reddit does, and mark posts that were analysed but drew no badge so the selector skips them. | x/observer.ts:40–96, x/dom.ts:27–37, bluesky/observer.ts:44–92 | Small on the fixture (< 5 ms at 4x); on live X it removes a per-mutation O(posts-in-DOM) query and `WeakMap` loop from every idle period. |
| 8 | **Trim per-item string work:** compare normalised text instead of a per-post `RegExp` in Bluesky's `displayNameOf`; one span pass for both X labels. | bluesky/dom.ts:118–127, x/dom.ts:61–90 | ~10 ms of 82 ms on the Bluesky fixture at 4x; a few ms on X. |
| 9 | **Defer non-critical startup work:** build the bigram lookup and weight tables on first use rather than at module evaluation. | core/handle/bigram.ts, scoring/weights.ts | A few ms of the 27–31 ms evaluation at 4x; worth measuring before doing. |

## After the fixes

Measured on 2026-10-22 on the same machine and browser, with the same runner and five runs per
condition, after these changes from the `perf-fixes` branch:

- Reddit Tier 0 reads the APP tag once per item (fix 1).
- The observers analyse in idle slices capped at the idle deadline or 8 ms (fix 2).
- Only posts within one screen of the viewport are analysed; the rest follow as the reader
  scrolls (fix 3, ADR-0019).
- A Tier 1 emission that changes no value or tier of a scored account skips the rescore (the
  `absorb` part of fix 4; the relay text, locale and reason-string parts are not done).
- Each badge releases WXT's invalidation listener when it is removed (fix 6).
- Badge and card shadow roots adopt one constructed stylesheet instead of a `<style>` copy each
  (the stylesheet part of fix 5; the mount still goes through WXT's `createShadowRootUi`).

The baseline was re-measured in the same session for a like-for-like comparison, so its numbers
differ by run-to-run noise from the tables above. Every cell is extension minus bare (Δ) or the
extension run alone, median of five, before → after.

### At full speed (1x), before → after

| Fixture | load Δ (ms) | Script Δ (ms) | TBT Δ (ms) | Long tasks | First badge (ms) | Badges at settle | Scroll long tasks | Scroll max frame gap (ms) | Scroll script Δ (ms) | Heap Δ (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| reddit-feed-300 | +12.3 → +9.6 | +13.9 → +9.3 | 0 → 0 | 0 → 0 | 59.4 → 62.4 | 30 → 5 | 0 → 0 | 16.8 → 16.8 | 0 → +4.4 | +1.4 → +0.8 |
| reddit-comments-1500 | +38 → +38.3 | +29.2 → +11.1 | 0 → 0 | 0 → 0 | 39.5 → 39.6 | 37 → 1 | 0 → 0 | 16.8 → 16.8 | −1.6 → +5.4 | +3.1 → +0.7 |
| x-timeline-400 | +13.6 → +13.5 | +31.1 → +20.9 | 0 → 0 | 0 → 0 | 39.1 → 40.6 | 40 → 2 | 0 → 0 | 16.8 → 16.8 | −0.5 → +10.9 | +2.4 → +1.2 |
| bluesky-feed-300 | +10.7 → +11.4 | +8.6 → +10.3 | 0 → 0 | 0 → 0 | 10 → 52.1 | 15 → 1 | 0 → 0 | 16.8 → 16.8 | +0.2 → +9.8 | +1.4 → +0.7 |

### With 4x CPU throttling, before → after

| Fixture | load Δ (ms) | Script Δ (ms) | TBT Δ (ms) | Long tasks | First badge (ms) | Badges at settle | Scroll long tasks | Scroll max frame gap (ms) | Scroll script Δ (ms) | Heap Δ (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| reddit-feed-300 | +41.5 → +40.8 | +62.8 → +43.6 | 0 → 0 | 0 → 0 | 85.2 → 68.1 | 30 → 5 | 0 → 0 | 16.8 → 16.8 | 0 → +18.5 | +1.4 → +0.8 |
| reddit-comments-1500 | +44.9 → +42.2 | +123 → +47.5 | **+48 → 0** | **1 → 0** | 153 → 77.5 | 37 → 1 | 0 → 0 | 16.8 → 16.8 | +6.5 → +29.4 | +3.1 → +0.7 |
| x-timeline-400 | +46.2 → +42.4 | +134 → +84.1 | 0 → 0 | 0 → 0 | 119 → 84.1 | 40 → 2 | 0 → 0 | 16.8 → 16.8 | +2.2 → +43.8 | +2.4 → +1.2 |
| bluesky-feed-300 | +47.3 → +45.4 | +35.3 → +42.2 | 0 → 0 | 0 → 0 | 73.3 → 42.4 | 15 → 1 | 0 → 0 | 16.8 → 16.8 | −0.1 → +28.2 | +1.4 → +0.7 |

DOMContentLoaded still moved by at most ±2 ms (−5.5 ms on X at 4x, as before). "Badges at
settle" now counts the badges near the first screen, not the whole page: that is the point of
fix 3. Live insertion on the Reddit feed (50 posts appended after scrolling to the bottom) now
mounts 3 badges instead of 6, the ones within a screen of the viewport, after 69 ms at 1x and
70 ms at 4x, with no long task. The X page's last badge (538 ms at 1x) is still the Tier 1
verdicts arriving with the second timeline fetch.

**Every post the reader scrolls to still gets its badge.** A one-off Playwright check scrolled
each fixture one viewport at a time (400 ms per step, 1280×800) with the previous build and with
this one, counting the badges inside the viewport at every step. After the last step both builds
had mounted the same totals (30, 37, 40 and 15). On the Reddit feed, X and Bluesky the visible
count matched at every step (14, 57 and 44 steps). On the comment thread it matched at 126 of 128
steps; at the other two, one account's earlier comment had no badge yet. That account's first
comment renders no avatar and its later ones a default avatar, and the Unsure verdict needs the
avatar signal, so it only appears once a later comment comes near and then badges all of that
account's comments. This is the evidence-accrual consequence recorded in ADR-0019, not a missed
post; live Reddit renders the same author row on every comment by an account.

A 4x CPU profile of the comment thread (unminified build) puts the extension's self time at
46.9 ms, down from 126.5 ms; 27.5 ms of it is bundle evaluation and 10.9 ms the first slices of
analysis.

### Verdict after the fixes

**The target now holds on every fixture at both speeds**: no long task and no blocking time
from navigation to settle, none while scrolling, no dropped frames (the longest frame gap stays
16.8 ms, the same as bare), and badges arrive as the analysis of each screen finishes.

| Fixture | Meets "next to no impact; badges lazy-load as analysis finishes"? |
| --- | --- |
| reddit-feed-300 | Yes. Script −30% at 4x, heap −0.6 MB; the first screen's badges land 62–68 ms after `load`. |
| reddit-comments-1500 | Yes, and this is the one that changed verdict: the ~94 ms first-pass long task is gone (TBT +48 → 0 ms at 4x), script −61% at 4x, heap +3.1 → +0.7 MB. |
| x-timeline-400 | Yes. Script −37% at 4x; Tier 1 rescoring of unchanged bodies is skipped. |
| bluesky-feed-300 | Yes, with a cost moved rather than removed: load-time script is about the same, and scrolling now costs 28 ms of script at 4x (no long task, no dropped frame). The first badge at 1x lands later (10 → 52 ms after `load`) because analysis now waits for the IntersectionObserver and an idle slot. |

What did not move:

- **The `load` event shift (10–38 ms at 1x, 41–45 ms at 4x) is unchanged.** It is not the
  analysis pass: that pass shrank by more than half on the comment thread and the shift stayed
  within noise. The profile points at bundle evaluation (27.5 ms at 4x) and content-script
  startup, so fix 9 (defer startup work) and a smaller bundle are the levers for it.
- **Scrolling now does work.** Analysis moved from load to the moment posts come near, so scroll
  script grew by 4–11 ms at 1x and 18–44 ms at 4x across the whole scroll, spread over idle
  slices. Each analysed post that mounts a badge is a mutation, and on X and Bluesky every
  mutation still rescans the whole document (hotspot 6); fix 7 is the next step and would cut
  most of the X and Bluesky scroll cost.
- Not done from the ranked list: relaying response text instead of a parsed object, the
  per-page locale and selected-reasons-only rendering (rest of fix 4), owning the mount (rest of
  fix 5), fixes 7, 8 and 9.

## Badges on every account

Measured on 2026-10-25 on the same machine and browser, with the same runner and five runs per
condition, after ADR-0020: every account near the viewport mounts a badge (Likely human on by
default, No read for unknown accounts) and Reddit looks each author up on sight. "Before" is the
build of `Record the performance after the fixes` on top of the diagnostics branch, re-measured in
the same session; "after" is the tip of `badges-everywhere`. The fixture server answers Reddit's
`about.json` with a 404, so every on-sight lookup on the Reddit fixtures runs and returns quickly
(a live session waits on the network instead, off the main thread). Every cell is extension minus
bare (Δ) or the extension run alone, median of five, before → after.

### At full speed (1x), before → after

| Fixture | load Δ (ms) | Script Δ (ms) | Layout Δ (ms) | TBT Δ (ms) | Long tasks | Badges at settle | Last badge (ms) | Scroll long tasks | Scroll max frame gap (ms) | Scroll script Δ (ms) | Heap Δ (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| reddit-feed-300 | +11.4 → +11.1 | +10.3 → +10.7 | +3.3 → +5.2 | 0 → 0 | 0 → 0 | 5 → 45 | 62.2 → 64.2 | 0 → 0 | 16.8 → 16.8 | +9.0 → +15.8 | +0.8 → +1.1 |
| reddit-comments-1500 | +40.4 → +39.6 | +12.4 → +15.6 | +0.7 → +8.5 | 0 → 0 | 0 → 0 | 1 → 24 | 41.5 → 40.7 | 0 → 0 | 16.8 → 16.8 | +9.1 → +6.7 | +0.7 → +0.9 |
| x-timeline-400 | +10.9 → +15.3 | +24.2 → +22.6 | +3.8 → +4.7 | 0 → 0 | 0 → 0 | 2 → 15 | 541 → 44.4 | 0 → 0 | 16.8 → 16.8 | +13.9 → +14.2 | +1.2 → +1.4 |
| bluesky-feed-300 | +10.3 → +11.9 | +10.1 → +10.3 | +3.1 → +3.7 | 0 → 0 | 0 → 0 | 1 → 7 | 52.9 → 52.6 | 0 → 0 | 16.8 → 16.8 | +14.7 → +17.5 | +0.7 → +0.8 |

### With 4x CPU throttling, before → after

| Fixture | load Δ (ms) | Script Δ (ms) | Layout Δ (ms) | TBT Δ (ms) | Long tasks | Badges at settle | Last badge (ms) | Scroll long tasks | Scroll max frame gap (ms) | Scroll script Δ (ms) | Heap Δ (MB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| reddit-feed-300 | +41.7 → +42.0 | +44.9 → +53.0 | +10.0 → +18.9 | 0 → 0 | 0 → 0 | 5 → 45 | 59.1 → 110 | 0 → 0 | 16.8 → 16.8 | +22.8 → +30.2 | +0.8 → +1.1 |
| reddit-comments-1500 | +46.9 → +41.5 | +45.5 → +55.2 | +4.3 → +24.9 | 0 → 0 | 0 → 0 | 1 → 24 | 78.3 → 179 | 0 → 0 | 16.8 → 16.8 | +32.6 → +44.1 | +0.8 → +1.0 |
| x-timeline-400 | +41.3 → +41.1 | +79.2 → +85.9 | +12.2 → +11.7 | 0 → 0 | 0 → 0 | 2 → 15 | 90.1 → 93.1 | 0 → 0 | 16.8 → 16.8 | +33.9 → +44.9 | +1.3 → +1.4 |
| bluesky-feed-300 | +45 → +45.1 | +43.5 → +43.4 | +11.2 → +14.6 | 0 → 0 | 0 → 0 | 1 → 7 | 44.1 → 49.8 | 0 → 0 | 16.8 → 16.8 | +28.0 → +34.7 | +0.7 → +0.8 |

DOMContentLoaded moved by at most ±6.1 ms in both builds. Live insertion on the Reddit feed (50
posts appended after scrolling) now mounts 23 badges instead of 3, the last 61 ms after insertion
at 1x and 64.5 ms at 4x, with no long task.

**The target still holds on every fixture at both speeds:** no long task and no blocking time from
navigation to settle, none while scrolling, and the longest scroll frame gap is 16.8 ms in every
one of the five runs per fixture (one "before" run on the comment thread at 4x had a 33 ms gap).
7 to 24 times as many badges near the first screen cost up to 10 ms more script and 21 ms more
layout at 4x (the most on the Reddit feed and the 1,500-comment thread), and 0.1–0.3 MB of heap;
scrolling costs up to 7 ms more script at 1x and 7–12 ms at 4x across the whole scroll, spread over
idle slices. The later "last badge" times at 4x are the extra badges' mounts landing over a few more
idle slices and, on Reddit, the No read badges rescoring as their lookups settle. The X page's last
badge at 1x moved from 541 ms to 44 ms because its Likely human badges mount with the first slice
instead of waiting for nothing.

**One regression was found and fixed on the way.** With every Reddit author waiting for its lookup,
the first version pulsed every waiting badge's glyph, and the comment thread dropped a frame (33 ms
gap) in three to seven of the ten scroll steps of every run at 4x, while a build with the on-sight
lookups turned off, and one with the pulse removed, dropped none. Waiting badges on Reddit now hold
a still, dimmed glyph and only the badge under the pointer pulses (`stillWhileLoading` in
`src/ui/Badge.tsx`); the tables above are measured with that change.

## Measurement caveats

- **Fast machine.** An M5 Pro is several times faster than a typical laptop. The 4x CDP throttle
  slows the renderer's main thread only (not the compositor, GPU or network), so it is an
  approximation of a mid-range machine, not a substitute for one.
- **Headless.** New headless mode renders and runs `requestAnimationFrame` at 60 Hz, but it has
  no real display or GPU contention; the frame-gap numbers mean "the main thread was free", not
  "frames reached a screen". Scrolling uses `scrollTo`, not a user gesture. A headed run
  (`--headed`) is the next check.
- **Fixtures, not live sites.** The fixture items are much smaller than live markup (a live X
  cell and a live `shreddit-post` shadow root carry many more elements), and no site JavaScript
  competes for the main thread, so DOM-walking costs (hotspots 1, 6, 7) are understated and
  absolute load times are meaningless. The deltas are the result. Live behaviour the fixtures do
  not exercise: X's list virtualisation (hotspot 5), continuous React mutations (hotspot 6),
  Reddit's lazily loaded comment partials, and Tier 2 lookups on hover.
- **Probe cost.** The probe's 50 ms badge poll walks every Reddit host's shadow root; it runs
  identically in both conditions, so it cancels out of the deltas but inflates the bare
  numbers on the comment thread.
- **Warm runs.** One warm-up per fixture and browser means the HTTP and code caches are warm, as
  for a returning user. The first page after a browser start costs more.
- **One machine, five runs.** Medians of five. First-badge time varied by up to 46 ms between
  runs at 1x and 113 ms at 4x (it depends on when the idle callback fires); long-task counts and
  TBT were identical across runs except where noted.

## Reproducing

```bash
pnpm build
pnpm perf -- --out .output/perf                      # 1x, five runs per condition
pnpm perf -- --cpu-throttle 4 --out .output/perf-4x  # 4x
pnpm perf -- --only reddit-comments-1500 --runs 1 --cpu-throttle 4 --profile \
  --build <unminified chrome-mv3 build> --out .output/perf-profile
```

`--profile` writes `<fixture>.cpuprofile` (load it in Chrome DevTools' Performance panel) and
`<fixture>-profile.md`. For readable function names, build once with Vite's `build.minify` set to
`false` into a separate output directory (for example a throwaway WXT config that spreads
`wxt.config.ts` and overrides `outDir` and `vite`) and pass that `chrome-mv3` folder to `--build`.
Line numbers in the profile refer to that build, not to `src/`; the hotspot section maps them
back to source.
