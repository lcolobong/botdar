# Store listing and disclosure texts

Copy from here into the Chrome Web Store developer dashboard and the Firefox AMO submission form.
The texts are plain: no accuracy figures, no emoji, no claims about any named account. The 512 px
store icon is `icon-512.png` beside this file; screenshots are described in
[screenshots/README.md](screenshots/README.md).

## Chrome Web Store

### Short description (132 characters max)

```
In-feed badges on X, Reddit and Bluesky when an author shows patterns common in automated accounts. Nothing leaves your browser.
```

### Full description

```
Botdar adds a small badge next to the author of a post when that account shows patterns common in
automated accounts, and a hover card that explains why. It works on X, Reddit and Bluesky.

Botdar describes patterns, not people. The badge says that an account's public details look the way
automated accounts often look, for example a very young account posting at a high rate, or a handle
made of a name plus a string of digits. Every hover card lists the two to four observations behind the
badge, each with a number or a date in it, and ends with a line that names the innocent explanation,
because a newsroom or a brand account can show the same patterns. There is a "This looks wrong" button
on every card. Botdar never hides, collapses or filters a post.

The feed stays quiet by default. Accounts that look fine, and accounts with too little data, get no
badge at all. A badge appears only when the signals line up: "Likely bot" when several independent
signals agree, "Unsure" when only one or two do, and "Declared bot" when the platform's own automated
label is set. An optional "Likely human" badge can be turned on in the settings.

Label styles are a setting. Plain (the default) uses the labels above. The Sus scale uses "Sus",
"Kinda sus", "Honest self-report bot" and "Real af". Icon only shows the glyph alone and keeps the words
in the tooltip and the hover card. The style changes the words only; colors, glyphs and the reasons on
the card are the same in every style.

Everything is computed in your browser from what the page already shows or already fetched for itself.
A conservative mode turns off the optional profile lookups, and each platform can be switched off on
its own.

What leaves your browser:

One thing: once a day the extension downloads a small signed configuration file from this project's
GitHub Pages site. That request carries no information about you or about the accounts you have seen.
GitHub may log the request like any web request.

Nothing else. No account names, no scores, no browsing history, no analytics, no crash reports.

Botdar is open source under the MIT licence: https://github.com/lcolobong/botdar
Privacy page: https://lcolobong.github.io/botdar/privacy.html
```

### Category

Social & Communication

### Single-purpose statement

```
Botdar has one purpose: to show, next to each post author on X, Reddit and Bluesky, a badge that says
whether that account displays patterns common in automated accounts, with a hover card listing the
observations behind it. All computation happens in the browser, and the extension has no other
features.
```

### Permission justifications

**storage**

```
Stores the user's settings (which platforms are on, conservative mode, label style), the last
downloaded signed configuration file, and the optional "This looks wrong" feedback the user chooses to
record, which stays on the device until the user exports or clears it. No account signals or scores are
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
the old site layout, draws the badge next to each author and, on hover, may request the same public
profile information the page itself shows.
```

**Host permission: https://bsky.app/\***

```
Needed to run the content script that reads Bluesky feeds and threads, draws the badge next to each
author and, on hover, may request the same public profile information the page itself shows.
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

| Question                                               | Answer                                                                                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the extension collect or transmit user data?      | No. Nothing is collected or transmitted. The only request the extension makes on its own is the daily download of a signed configuration file, which carries no user data. |
| Personally identifiable information                    | Not collected                                                                                                                                                          |
| Health, financial and payment, authentication          | Not collected                                                                                                                                                          |
| Personal communications                                | Not collected                                                                                                                                                          |
| Location                                               | Not collected                                                                                                                                                          |
| Web history                                            | Not collected                                                                                                                                                          |
| User activity                                          | Not collected                                                                                                                                                          |
| Website content                                        | Read on the device to compute the badge; never stored beyond the open tab and never transmitted                                                                        |
| Does the extension use remote code?                    | No. The configuration file is data validated against a schema; all logic ships in the package.                                                                         |
| Is data sold to third parties?                         | No                                                                                                                                                                     |
| Is data used for purposes unrelated to the core function? | No                                                                                                                                                                  |
| Is data used to determine creditworthiness or for lending? | No                                                                                                                                                                 |

Certification: the extension complies with the Chrome Web Store Developer Program Policies, including
the Limited Use requirements.

## Firefox AMO

### Summary (250 characters max)

```
In-feed badges on X, Reddit and Bluesky when a post's author shows patterns common in automated
accounts, with a hover card that lists the reasons. Everything is computed in your browser; nothing
about the accounts you see leaves it.
```

### Description

Use the Chrome Web Store full description above, unchanged.

### Categories

Social & Communication; Privacy & Security.

### Data collection

The manifest declares `browser_specific_settings.gecko.data_collection_permissions` with
`required: ["none"]`. In the submission form, state:

```
This add-on does not collect or transmit any data. It declares data_collection_permissions: none. The
only request it makes on its own is a once-a-day download of a signed configuration file from the
project's GitHub Pages site, which carries no information about the user or the accounts they have
seen. Settings, the last configuration file and optional user-recorded feedback are kept in the
browser's local storage and never leave the device.
```

### Permission notes for the reviewer

```
storage: settings, the last downloaded configuration file, and optional user-recorded feedback.
alarms: the once-a-day configuration download.
Host permissions (x.com, twitter.com, www.reddit.com, old.reddit.com, bsky.app): the content scripts
that draw the badges and, on hover, may request the same public profile information the page shows.
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
