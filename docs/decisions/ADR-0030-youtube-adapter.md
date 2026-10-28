# ADR-0030: YouTube comment authors, looked up on hover through innertube

Status: Accepted · Date: 2026-10-27 · Amends ADR-0005

## Context

ADR-0005 put YouTube comment authors in v1.1. The research (docs/research/feasibility.md, "YouTube";
docs/research/heuristics.md) found that comments are where YouTube's automated accounts work: scam
comments were 2.34% of 8.8M comments studied, posted by about 10,000 accounts that abuse account names
and look-alike characters (NDSS 2024), and scam bots ran on 31.73% of crawled videos (IMC 2023). A
comment shows almost nothing about its author, so each one needs a channel lookup, and the YouTube
Data API forbids derived metrics, so the lookup has to be the page's own.

Facts checked while building it, on 2026-10-27, with headless Playwright Chromium from a fresh
profile, signed out, nothing accepted (no consent or bot wall appeared):

- A watch page's comments are `ytd-comment-view-model` elements; a reply carries `is-reply` inside its
  thread's replies renderer. The author is an `#author-text` link to `/@<handle>` (any script,
  percent-encoded in the link); **a comment shows the handle and no display name**. Recorded under `tests/fixtures/youtube/html/watch.html` (a BBC News video, 553 comments in
  the header, 40 top-level comments and 20 replies loaded, 56 handles).
- An avatar under `yt3.ggpht.com/ytc/` is either YouTube's coloured letter or the Google account's
  photo (25 letters and 7 photos among 32 on one page, checked by rendering them); only a path outside
  `ytc/` is certainly uploaded. So the URL can say "uploaded", never "default", and the avatar is
  not read at all.
- YouTube is a single-page app built on Polymer, which recycles comment elements: moving to another
  video, re-sorting and continuations can re-bind an element's author link in place or stamp a
  removed element for another comment. The app dispatches `yt-navigate-finish` on the document,
  which a content script hears.
- A channel's facts are in its About panel (`aboutChannelViewModel`): join date, subscriber, view and
  video counts, sometimes a country. A count with nothing to show is left out of the panel. Among 57
  commenters sampled, 44 had no public videos, 48 no description, 9 no subscriber count, 3 a country,
  and 53 had joined more than two years earlier.
- The page itself reaches the panel with a continuation `browse` whose token comes from the channel
  page. The API also answers `navigation/resolve_url` for `https://www.youtube.com/@<handle>/about`
  with the channel id and the About tab's params, and a `browse` with those returns the panel and the
  channel title directly: two requests, about 35–50 KB for a typical commenter and about 1.9 MB for a
  large channel, whose home tab comes along. Both were recorded under
  `tests/fixtures/youtube/innertube/`, with the page's own continuation.
- The API needs no key, answers without cookies, and answers in English when the request context says
  `hl: "en"`; from a French-locale profile the About page's HTML answered in French, the API in
  English. The client version the context names is in the page's `ytcfg.set(...)` script, which the
  isolated world can read as text.

## Decision

Ship a YouTube adapter for watch-page comment authors: Tier 0 from the page, Tier 2 from the page's own
innertube API, made only when a badge is hovered.

- **Content script** on `https://www.youtube.com/*` (every page, since the app navigates in place),
  running the shared wiring of Reddit and Hacker News (`src/platforms/onSightWire.ts`) with a new
  `lookups: "onHover"` setting, so nothing is fetched until a hover.
- **Tier 0**: the handle (lowercased; a last word of "bot" declares), the video's creator from the
  watch metadata's owner link, and the creator chip on a creator's own comment. The observer reads a
  comment's handle again on every discovery and on every change of its author link's `href`, and a
  comment whose author changed is reported removed and then reported anew; navigation compares the
  page (path and video), not the whole address, so a timestamp or playlist changes nothing. Each
  comment also feeds the thread index (`thread.nearDuplicateReply`, `thread.sharedRareDomain`): the
  thread is the video, a reply's parent is its thread's top-level comment, the time is the relative
  age ("2 hours ago") counted back from when the comment is read, with page order breaking ties only
  inside one comment thread, links are the comment's anchors with YouTube's `/redirect?q=` wrapper
  undone, and the description's links are the root's, which never count.
- **Tier 2 route: innertube, not the About page's HTML.** `POST /youtubei/v1/navigation/resolve_url`
  then `POST /youtubei/v1/browse` with the id and params it returns, from the isolated world,
  same-origin, `credentials: "omit"`, context `{clientName: "WEB", clientVersion, hl: "en"}` with the
  version read from the page's `ytcfg.set` script (the recorded version as fallback). No MAIN-world
  script is needed: the API takes its client and language in the request body and wants no key. The
  same parser reads the page's own About continuation. On hover only, behind the shared limiter at 10 a
  minute, cached 24 h and persisted like other Tier 2 lookups (ADR-0025, without the title).
- **Features** (docs/scoring-spec.md, "YouTube"): `youtube.channelAgeDays` (Reddit's bins),
  `youtube.hasVideos` and `youtube.hasDescription` (−0.3 each, absence weighs nothing),
  `youtube.assignedHandle` (0.3; a code needs a letter and a digit, so "@euro-2024" is chosen), and
  `youtube.imitatesCreator` (2.0, handle group capped at 2.0): the handle, or once read the channel
  name, is the creator's name or handle alone or with digits, an assigned code or an impersonator's
  word, after folding case, separators, accents and look-alike letters. It compares names only, never
  comment text, and never fires for the creator's own account (its handle or the creator chip). Prior
  −2.5, confidence weights as on Reddit (no Tier 1). There is no avatar feature: the URL cannot tell
  YouTube's letter avatar from an account photo, and an uploaded avatar alone would weigh nothing.
- **Policy and settings**: `youtube` is a platform id like the others, with a user toggle; its build
  defaults declare no Tier 1.
- **Manifest**: one new host permission, `https://www.youtube.com/*`. The task named
  `*://www.youtube.com/*`; the https form matches the five existing hosts and ADR-0013, and YouTube
  redirects http to https, so `*://` would only add plain-http pages the extension never sees.

### What is GUESS

- The creator chip: `#author-comment-badge ytd-author-comment-badge-renderer`, assumed to replace
  `#author-text` as the visible name, so the badge anchors after it (`src/platforms/youtube/dom.ts`).
  No comment on the recording was the creator's.
- YouTube's `/redirect?q=` wrapper on links inside comments: recorded on the description only
  (`src/platforms/youtube/threadReply.ts`).
- YouTube's dark theme as a `dark` attribute on `<html>`: the recording is light
  (`src/ui/mount.ts`).

## Consequences

- The manifest grows by one host, a store resubmission (ADR-0013 accepts this per platform); the
  listing gains a justification naming the innertube requests. The privacy page says what a hover
  sends: the handle, to YouTube's own API on the same site, without cookies.
- Before a hover a commenter's badge reads from the page alone, which is No read for most of them
  (hollow and capped at Unsure until the lookup delivers), as on X and Bluesky. A handle posing as
  the creator reads Unsure from the page alone, and Likely bot once a weeks-old join date agrees.
- Every lookup depends on two undocumented endpoints and the shape of the About panel; a change makes
  hovers fall to No read until the parser follows (risk-register R-18). The policy can switch YouTube
  Tier 2 off for everyone.
- Relative ages and the About texts are read in English. A viewer whose YouTube interface is in
  another language gets no copied-reply or shared-link evidence on YouTube (the lookup still works:
  it asks for English).
- Re-sorting and recycled elements are handled for badges (the author is re-read and the badge
  replaced), but the thread index reads each element once, so a recycled element keeps its first
  reading there until the page is left; no re-sort has been recorded yet.
- `policy/src/v1.json` does not list YouTube; an omitted platform keeps its build defaults.

## Alternatives considered

- **Fetch the About page's HTML (`/@<handle>/about`) and read its `ytInitialData`.** One request and no
  client version, but 0.9–2.7 MB a lookup, its texts in the viewer's interface language (French from a
  French profile, with `hl=en` and an English `Accept-Language` alike), and, without cookies, the
  consent redirect a European visitor gets. Rejected.
- **Construct the About continuation token from the channel id.** A random panel id worked on
  2026-10-27 and would save the large `browse`, but it is a reverse-engineered protobuf. Rejected;
  every token used comes from YouTube's own answers.
- **A MAIN-world bridge to read `ytcfg` or intercept the page's own `browse` responses (ADR-0011).**
  The page never fetches a commenter's channel unless the reader opens it, so interception would
  deliver almost nothing, and the client version is readable as script text. Rejected.
- **Look every commenter up on sight, as on Reddit and Hacker News.** Two requests per author, up to
  megabytes for a large channel, for every comment loaded: too costly for the viewer and too
  conspicuous to YouTube. Rejected.
- **The YouTube Data API.** Needs a key and quota, and its policies forbid derived metrics. Rejected.
- **Score likes and reply counts, or the subscriber count.** Likes and replies describe one comment;
  most commenters have a handful of subscribers and a hidden count looks like none. Not scored.
