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
- A popup with the policy status, per-platform switches and conservative mode.
- An options page for platforms, lookups, badge settings, feedback and the policy file.
- A three-panel onboarding page on first run.
- Badges and cards that follow the host's light or dark theme and font.
- A signed, restrict-only policy file fetched once a day that lets the maintainer switch a platform or
  a signal source off for everyone without a store release. It can never enable anything.
- Conservative mode, which turns off the optional profile lookups locally.
- Chrome and Firefox builds from one codebase. Firefox 128 or later.

### Privacy

- Nothing about the accounts you see leaves the browser. The only request the extension makes on its
  own is the daily policy fetch, which carries no user data.
- Only the `storage` and `alarms` permissions, and host permissions for x.com, twitter.com,
  www.reddit.com, old.reddit.com and bsky.app.
