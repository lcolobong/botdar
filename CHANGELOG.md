# Changelog

All notable changes to Botdar. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

The first release, covering the MVP.

### Added

- Badges next to post authors on X (home timeline and threads), Reddit (feeds and comment threads, on
  both the current and the old layout) and Bluesky (feeds and threads) when an account displays
  patterns common in automated accounts.
- Three badge tiers: "Likely bot" when several independent signals agree, "Unsure" when only one or
  two do, and "Declared bot" when the platform's own automated label is set. Accounts that look fine
  and accounts with too little data get no badge, so the feed stays quiet.
- A hover card for every badge that lists the two to four observations behind it, each with a number
  or a date, a strength bar and an arrow for how strong a flag it is and which way it points, and a
  short explanation of why it counts behind one "What these mean" link; a note when some data
  sources did not deliver; and, under "Why this could be wrong", the innocent explanation.
- A hollow badge when fewer than half the data sources delivered and a dashed badge when lookups are
  paused.
- A "This looks wrong" button on every card. Feedback stays on the device and can be exported or
  cleared from the options page.
- Three label styles: Plain (default), Sus scale and Icon only. Styles change the words only.
- An optional "Likely human" badge, off by default.
- On Reddit, a hover card for an account of six months or more also weighs its karma per day since its
  first visible post or comment, using the account's public activity list, so an aged account is no
  longer exempt from a rate check.
- A popup with the policy status, per-platform switches and conservative mode.
- An options page for platforms, lookups, badge settings, feedback and the policy file.
- A three-panel onboarding page on first run.
- Badges and cards that follow the host's light or dark theme and font.
- A signed, restrict-only policy file fetched once a day that lets the maintainer switch a platform or
  a signal source off for everyone without a store release. It can never enable anything.
- Conservative mode, which turns off the optional profile lookups locally.
- Remembered lookups: profile data a lookup returned is kept on the device for seven days under salted
  one-way hashes, so the same account is not fetched again after a reload. "Remember lookups for 7
  days" turns it off and "Clear cache" erases it, both on the options page.
- On X, one weak observation when the country in an account's "About this account" panel is not one
  where the language of its own bio and posts is commonly spoken ("Based in Brazil, writes in
  Russian"). The language is read on the device from a bundled word list, never from your browser's
  settings, and English, written everywhere, is never compared.
- Posting cadence on X and Bluesky: "Posts at regular intervals" when the gaps between an account's
  latest posts barely vary, and "Posts around the clock" when it has no daily quiet hours. On X this
  reads the profile timeline the page already loaded when you open a profile; on Bluesky a hover also
  asks Bluesky's public service for the author's last 100 posts.
- Copied replies on X, Reddit, Bluesky and Hacker News: "Reply closely matches earlier ones by 2 other
  accounts" when other accounts posted nearly the same reply earlier in the same thread. Only the
  copies count, never the first author, and short replies and quoted text are never compared. It
  reads the thread on the page you are viewing and keeps nothing once you leave it (ADR-0027).
- Chrome and Firefox builds from one codebase. Firefox 128 or later.
- Hacker News (front page, /newest, threads, /newcomments), pulled forward from v1.1: a badge after
  every story and comment author, read from the public Firebase API's join date, karma, submission
  count and about text as each row comes into view. The account on its own user page gets no badge
  (ADR-0026).

### Privacy

- Nothing is sent to the developer, and there is no Botdar server. To read an author's public
  profile, the extension sends that author's name to the platform: to x.com on hover and to the
  Reddit site you are on as posts come into view, both with your session; to Bluesky's public API
  at public.api.bsky.app on hover, and to the official Hacker News API at hacker-news.firebaseio.com
  as rows come into view, both without cookies. Conservative mode, the per-platform switches and
  the signed policy turn these lookups off. The daily policy fetch carries no user data.
- Only the `storage` and `alarms` permissions, and host permissions for x.com, twitter.com,
  www.reddit.com, old.reddit.com, bsky.app and news.ycombinator.com.
