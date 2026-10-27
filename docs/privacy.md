# Privacy

This is the source for the published privacy page. Keep it in plain language.

## What the extension does

It reads the social media pages you are already looking at, computes a small set of signals about each
post's author on your device, and draws a badge next to the author. That is all.

## What leaves your browser

Nothing is sent to us. Botdar has no server of its own: no account names, no scores, no browsing
history, no analytics and no crash reports ever reach the developer.

Two kinds of request do leave your browser.

**The daily configuration file.** Once a day the extension downloads a small signed configuration file
from this project's GitHub Pages site (`lcolobong.github.io`). That request carries no information about
you or about the accounts you have seen. GitHub may log the request like any web request. It is not
affected by the switches below.

**Profile lookups.** The page shows little more than a name, so to read an author's public profile the
extension asks the platform the post is on. Each request names one author (or, on Bluesky, a few
authors at once), the way the profile link on the page does, and goes either to the site you are using
or to that platform's official public API:

- **X**: to `x.com`, with your existing X session, when you hover a badge. It names the author's handle.
- **Reddit**: to the Reddit site you are on (`www.reddit.com` or `old.reddit.com`), with your existing
  Reddit session, when a post comes into view (at most once per author per page) and again when you
  hover a badge if the answer is not already remembered. It names the author's username.
- **Bluesky**: to Bluesky's public service at `public.api.bsky.app`, without your session, when you
  hover a badge. It names the author's handle, or Bluesky's internal account id for that author.
- **Hacker News**: to Hacker News's official public API at `hacker-news.firebaseio.com` (run by Y
  Combinator on Google's Firebase), without cookies, when a story or comment comes into view (at most
  once per author per page) and again when you hover a badge if the answer is not already remembered.
  It names the author's username.

A request to the site you are using carries that site's own cookies, as the site's own requests do;
nothing about you is added to any request. What comes back is kept on your device (see below) and is
never passed on.

To turn the lookups off: switch on "conservative mode" to stop every lookup on every platform, or switch
a platform off to stop everything Botdar does there. The maintainer can also turn them off for everyone,
per platform or everywhere, through the configuration file.

## What is stored on your device

- Your settings (which platforms are on, conservative mode).
- The last configuration file that was downloaded.
- Feedback you chose to record with the "This looks wrong" button, which stays on your device until you
  export or delete it from the options page.

- Remembered lookups: when a lookup returns profile data (for example follower counts and account age),
  the extension keeps that data on your device for seven days so the same account is not fetched again.
  On Reddit, a hover also keeps two numbers from the account's public activity list, the date of its
  oldest item and how many items it listed, for one day; no titles, comments or subreddits are read or kept.
  Each entry is filed under a one-way hash of the platform and the handle mixed with a random value
  created on your device, so the stored data lists no handles; it holds no display name and no bio text (only whether a bio is empty) and is never
  sent anywhere. At most 5,000 entries are kept, and expired ones are deleted. You can turn this off
  ("Remember lookups for 7 days") or erase it at any time ("Clear cache") on the options page; both
  remove every remembered lookup, and clearing also replaces the random value. With conservative mode on,
  nothing is read from or written to this store.

Scores for accounts are kept in memory while a tab is open and discarded afterwards.

To notice replies copied across accounts in one thread, the extension keeps, in memory, the set of
words each reply on the current page uses, with its author and time, never the text itself. The page
already shows these replies; nothing is requested for them, nothing is stored on disk, and the list is
dropped when you move to another page.

## Requests to platforms

What each lookup reads from the answer:

- On X, the "About this account" details the profile page offers: the account's country, how many times
  its username changed, and which app store it signed up through.
- On Reddit, the account's public profile: join date, karma, display name, bio and whether it has an
  avatar.
  When you hover a badge on an account that is at least six months old, the extension also asks for the
  account's latest public posts and comments (`/user/<name>/overview.json`) and reads only when they
  were posted and how many there are.
- On Bluesky, the public profile (join date, follower, following and post counts, bio, avatar, labels
  and verification) and the author's recent public posts, read only for when they were posted.
- On Hacker News, the public profile: join date, karma, how many items they have submitted, and their
  about text.

All lookups are rate-limited and cached: an answer is reused in the open tab for up to a day and,
unless you turn remembered lookups off, remembered on your device as described above. On Reddit, the lookups pause for ten minutes after Reddit
answers as if you were logged out.

## Permissions

The extension asks for access to x.com, twitter.com, reddit.com, bsky.app and news.ycombinator.com only,
plus local storage and a timer for the daily configuration fetch. The Bluesky and Hacker News APIs need
no permission of their own: they are open to requests from the Bluesky and Hacker News pages.

## Contact

Open an issue at https://github.com/lcolobong/botdar.
