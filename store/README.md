# Store listing and disclosure texts

Copy from here into the Chrome Web Store developer dashboard and the Firefox AMO submission form.
The texts are plain: no accuracy figures, no emoji, no claims about any named account. The 512 px
store icon is `icon-512.png` beside this file; screenshots are described in
[screenshots/README.md](screenshots/README.md).

## Chrome Web Store

### Listing name

`Botdar`, identical to the manifest `name`. The manifest `description` must also stay within 132
characters and match the short description below.

### Short description (132 characters max)

```
A badge on each author on X, Reddit, Bluesky and Hacker News for patterns common in automated accounts. Nothing is sent to us.
```

### Full description

```
Botdar adds a small badge next to the author of every post, saying whether that account shows patterns
common in automated accounts, and a hover card that explains why. It works on X, Reddit, Bluesky and
Hacker News.

Botdar describes patterns, not people. The badge says that an account's public details look the way
automated accounts often look, for example a very young account posting at a high rate, or a handle
made of a name plus a string of digits. Every hover card lists the two to four observations behind the
badge, and ends with a line that names the innocent explanation, because a newsroom or a brand account
can show the same patterns. There is a "This looks wrong" button on every card that gives a read. Botdar never hides, collapses or filters a post.

Every author gets a badge, so you can see that each account was looked at: "Likely bot" when several
independent signals agree, "Unsure" when only one or two do, "Declared bot" when the platform's own
automated label is set, "Likely human" when enough is visible and nothing stands out, and "No read"
when there is too little to go on, with the reason on the card. A badge reads "Checking" while the
account's public profile is loading. "Likely human" can be turned off in the settings for a quieter
feed.

Label styles are a setting. Plain (the default) uses the labels above. The Sus scale uses "Sus",
"Kinda sus", "Honest self-report bot", "Real af" and "Who dis". Icon only shows the glyph alone and keeps the words
in the tooltip and the hover card. The style changes the words only; colors, glyphs and the reasons on
the card are the same in every style.

Everything is computed in your browser from what the page already shows or already fetched for itself.
A conservative mode turns off the optional profile lookups, and each platform can be switched off on
its own.

What leaves your browser:

Nothing is sent to us. Botdar has no server: no account names, no scores, no browsing history, no
analytics and no crash reports reach the developer.

To read an author's public profile, Botdar asks the platform the post is on, naming that author the
way the profile link on the page does: x.com when you hover a badge, the Reddit site you are on when a
post comes into view, Bluesky's public service (public.api.bsky.app) when you hover a badge, and the
official Hacker News API (hacker-news.firebaseio.com) when a story or comment comes into view. Nothing
about you is added to these requests. Conservative mode turns them all off.

Once a day the extension also downloads a small signed configuration file from this project's GitHub
Pages site. That request carries no information about you or about the accounts you have seen. GitHub
may log the request like any web request.

Botdar is open source under the MIT licence: https://github.com/lcolobong/botdar
Privacy page: https://lcolobong.github.io/botdar/privacy.html
```

### Category

Social & Communication

### Single-purpose statement

```
Botdar has one purpose: to show, next to each post author on X, Reddit, Bluesky and Hacker News, a
badge that says whether that account displays patterns common in automated accounts, with a hover card listing the
observations behind it. All computation happens in the browser, and the extension has no other
features.
```

### Permission justifications

**storage**

```
Stores the user's settings (which platforms are on, conservative mode, label style), the last
downloaded signed configuration file, and the optional "This looks wrong" feedback the user chooses to
record, which stays on the device until the user exports or clears it, and, unless the user turns it
off, profile lookups kept for seven days under salted one-way hashes (no handles or names in readable
form), and two numbers from an account's public activity list for one day, so the same account is not
fetched twice; the user can clear them at any time. No scores are
written to storage.
```

**alarms**

```
Schedules the once-a-day download of the signed configuration file from the project's GitHub Pages
site. The alarm is the extension's only timer.
```

**Host permission: https://x.com/\* and https://twitter.com/\***

```
Needed to run the content script that reads the X timeline and threads, draws the badge next to each
post author and, on hover, may request the same public profile information the page itself shows.
twitter.com is included because X still serves the same application from that domain.
```

**Host permission: https://www.reddit.com/\* and https://old.reddit.com/\***

```
Needed to run the content script that reads Reddit feeds and comment threads on both the current and
the old site layout, draws the badge next to each author and, as each post comes into view and on
hover, may request from the same site the public profile information Reddit shows on the author's
profile page.
```

**Host permission: https://bsky.app/\***

```
Needed to run the content script that reads Bluesky feeds and threads and draws the badge next to each
author. On hover it may request that author's public profile and recent public posts from Bluesky's
public service at public.api.bsky.app, without cookies. That service allows requests from any page, so
it needs no host permission of its own.
```

**Host permission: https://news.ycombinator.com/\***

```
Needed to run the content script that reads Hacker News story lists and comment threads and draws the
badge next to each author. As each story or comment comes into view it may request that author's
public profile (join date, karma, submission count, about text) from the official Hacker News API at
hacker-news.firebaseio.com, without cookies. That API allows requests from the Hacker News page, so it
needs no host permission of its own.
```

No other host permissions are requested. There is no `<all_urls>`, no `tabs`, no `webRequest`, and no
`web_accessible_resources`.

### Justification for the MAIN-world fetch interception

Have this ready for a reviewer question about the page-world script on x.com and bsky.app.

```
On X and Bluesky, the feed renders only a name, a handle and an avatar for each author, while the
page's own API responses carry the author's public join date and public counts. Botdar registers a
small page-world content script that wraps window.fetch and XMLHttpRequest and reads a copy of the
responses the page has already received, for an explicit allowlist of the page's own feed, thread and
profile requests. It reads only responses the page already received: it never adds, changes or blocks a
request, never alters a response, and the original response is always returned to the page unchanged.
Nothing it reads is sent anywhere; the data is passed to the extension's isolated content script
through window.postMessage on the same origin, parsed as untrusted data, kept in memory for the open
tab and discarded when the tab closes. The script is under a hundred lines, ships inside the package
and is auditable in the public repository. It can be switched off in two ways: by the user, through
the per-platform switches and conservative mode in the options page, and by the maintainer for all
users at once, through the signed configuration file the extension downloads daily, which can only
restrict behaviour and never enable anything.
```

### Data-use disclosure (privacy practices tab)

| Question | Answer |
| --- | --- |
| Does the extension collect or transmit user data? | Yes: website content only, and never to the developer, who runs no server. To show a badge it sends the account name of an author shown on the page to that platform: to x.com and reddit.com, the sites the user is on, and to the platforms' official public APIs at public.api.bsky.app and hacker-news.firebaseio.com. The daily download of a signed configuration file carries no user data. |
| Personally identifiable information | Not collected |
| Health, financial and payment, authentication | Not collected (see the note on X's anti-forgery token below) |
| Personal communications | Not collected |
| Location | Not collected |
| Web history | Not collected |
| User activity | Not collected (see the note below) |
| Website content | Collected (tick it). The account names of authors shown on the page are sent to that platform's own site or official public API to fetch public profile facts. The answers are kept on the device, for seven days under salted hash keys unless the user turns that off, and never sent anywhere else. Conservative mode turns the requests off. |
| Does the extension use remote code? | No. The configuration file is data validated against a schema; all logic ships in the package. |
| Is data sold to third parties? | No |
| Is data used for purposes unrelated to the core function? | No |
| Is data used to determine creditworthiness or for lending? | No |

Why Website content and not the other categories, for whoever fills in the form:

- **Website content** is the honest category: what leaves the browser is text the page displays, an
  author's handle or username (on Bluesky sometimes the account id the page loaded for that author),
  sent so the platform can return that author's public profile. The requests and their triggers are
  listed per platform in [docs/privacy.md](../docs/privacy.md), "What leaves your browser".
- **User activity** (clicks, mouse position, scrolling, keystrokes) is not recorded or sent. A lookup on
  X or Bluesky starts when the user hovers a badge, so the platform could infer that the user looked at
  that author, but the request carries only the author's name, and X's own hover card asks X for
  profile details the same way. On Reddit and Hacker News the lookup follows what is on screen, which
  the platform itself served. If a reviewer reads the hover trigger as user activity, ticking User
  activity as well is the safe answer; nothing else changes.
- **Web history** is not sent: no request mentions any other site or page, and each platform only
  hears about accounts on its own pages.
- **Authentication information**: on X, the lookup copies X's anti-forgery token (the `ct0` cookie) into
  a request header, as X's own web app does, and X and Reddit requests carry the session cookies the
  browser attaches to any request to those sites. The token and cookies go back only to the site that
  issued them and are never stored or sent elsewhere, so nothing is collected.

Certification: the extension complies with the Chrome Web Store Developer Program Policies, including
the Limited Use requirements. Website content is used only to compute the badge, the single purpose;
it is transferred only to the platform it came from, because the badge needs that platform's public
profile facts, and it is never sold, used for advertising, or read by people.

## Firefox AMO

### Summary (250 characters max)

```
In-feed badges on X, Reddit, Bluesky and Hacker News when a post's author shows patterns common in
automated accounts, with a hover card that lists the reasons. Everything is computed in your browser, and
nothing is sent to us.
```

### Description

Use the Chrome Web Store full description above, unchanged.

### Categories

Social & Communication; Privacy & Security.

### Data collection

The manifest declares `browser_specific_settings.gecko.data_collection_permissions` with
`required: ["websiteContent"]`. Mozilla's add-on policies count as data transmission any data
"collected, used, transferred, shared, or handled outside of the add-on or the local browser", with no
exception for the site the user is on, and two of the lookups go to API hosts that are not the page at
all (public.api.bsky.app and hacker-news.firebaseio.com), so `none` would understate them. In the
submission form, state:

```
This add-on sends nothing to its developer, who runs no server. To show a badge it sends the account
name of an author shown on the page to that platform: to x.com and reddit.com, the sites the user is
on, and to the platforms' official public APIs at public.api.bsky.app (Bluesky) and
hacker-news.firebaseio.com (Hacker News), so the platform can return that author's public profile. It
declares websiteContent for this. Conservative mode and the per-platform switches turn these requests
off. The only other request is a once-a-day download of a signed configuration file from the project's
GitHub Pages site, which carries no information about the user or the accounts they have seen.
Settings, the last configuration file, optional user-recorded feedback and seven-day remembered
lookups (salted hashes, switchable and clearable) are kept in the browser's local storage and never
leave the device.
```

### Permission notes for the reviewer

```
storage: settings, the last downloaded configuration file, optional user-recorded feedback, and
seven-day remembered lookups keyed by salted hashes (can be switched off and cleared on the options page).
alarms: the once-a-day configuration download.
Host permissions (x.com, twitter.com, www.reddit.com, old.reddit.com, bsky.app, news.ycombinator.com):
the content scripts that draw the badges and may request an author's public profile from the same site
(X on hover, Reddit as posts come into view). Bluesky and Hacker News lookups go to public.api.bsky.app
and hacker-news.firebaseio.com, which allow requests from those pages and need no host permission.
```

Add the MAIN-world fetch interception paragraph from the Chrome section, unchanged, to the reviewer
notes. Firefox 128 is the minimum version because page-world content scripts are registered in the
manifest.

### Source code submission

Upload the `botdar-<version>-sources.zip` produced by `pnpm zip:firefox` (also attached to the GitHub
Release). Build instructions for the reviewer:

```
Node 24 and pnpm 12 (corepack enable). Run: pnpm install --frozen-lockfile && pnpm zip:firefox
The package is written to .output/botdar-<version>-firefox.zip.
```
