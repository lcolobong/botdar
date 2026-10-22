# Privacy

This is the source for the published privacy page. Keep it in plain language.

## What the extension does

It reads the social media pages you are already looking at, computes a small set of signals about each
post's author on your device, and draws a badge next to the author. That is all.

## What leaves your browser

One thing: once a day the extension downloads a small signed configuration file from this project's
GitHub Pages site. That request carries no information about you or about the accounts you have seen.
GitHub may log the request like any web request.

Nothing else. No account names, no scores, no browsing history, no analytics, no crash reports.

## What is stored on your device

- Your settings (which platforms are on, conservative mode).
- The last configuration file that was downloaded.
- Feedback you chose to send with the "This looks wrong" button, which stays on your device until you
  export or delete it from the options page.

Signals and scores for accounts are kept in memory while a tab is open and discarded afterwards.

## Requests to platforms

On X, Reddit and Bluesky, when you hover a badge, the extension may ask the platform for the same public
profile information the page itself shows, using your existing session. These requests are rate-limited,
cached, and can be turned off with "conservative mode" or per platform. The maintainer can also turn them
off for everyone through the configuration file.

## Permissions

The extension asks for access to x.com, twitter.com, reddit.com and bsky.app only, plus local storage
and a timer for the daily configuration fetch.

## Contact

Open an issue at https://github.com/lcolobong/botdar.
