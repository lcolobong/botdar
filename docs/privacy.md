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

To notice one small site linked by many accounts in one thread, it also keeps, in memory, the site
names (such as example.com, never the rest of the address) that each reply on the page links. On X,
which shows links only as t.co, the names come from the conversation data the page already loaded. The
site names are kept for at most 5,000 posts while the tab stays on the site, so that returning to a
thread finds them again, and are gone when the tab is closed or reloaded.

## Requests to platforms

On X and Bluesky when you hover a badge, and on Reddit when a post comes into view, the extension may ask
the platform for the same public profile information the page itself shows, using your existing session.
On Reddit that is one request per author per page at most, and the cache answers repeats. When you
hover a badge on an account that is at least six months old, the extension also asks Reddit for the
account's latest public posts and comments (`/user/<name>/overview.json`), again with your session, and
reads only when they were posted and how many there are. On Bluesky
a hover also asks Bluesky's public service, without your session, for that author's recent public
posts, to read only when they post.

On Hacker News, when a story or comment comes into view, the extension asks Hacker News's official public
API at `hacker-news.firebaseio.com` (run by Y Combinator on Google's Firebase) for that author's public
profile: join date, karma, how many items they have submitted, and their about text. The request names
the author, as the profile link on the page does; it carries no cookies and nothing about you. It is one
request per author per page at most, and the cache answers repeats.

These requests are rate-limited, cached, and can be turned off with "conservative mode" or per platform.
The maintainer can also turn them off for everyone through the configuration file.

## Permissions

The extension asks for access to x.com, twitter.com, reddit.com, bsky.app and news.ycombinator.com only,
plus local storage and a timer for the daily configuration fetch. The Hacker News API needs no permission
of its own: it is open to requests from the Hacker News page.

## Contact

Open an issue at https://github.com/lcolobong/botdar.
