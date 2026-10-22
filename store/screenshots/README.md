# Store screenshots

Both stores take 1280x800 PNGs. Capture them with `pnpm smoke` once the smoke harness lands; until
then, capture them by hand from a build loaded unpacked in a 1280x800 window at device scale 1.

Rules for every capture:

- The plain label style (the default). The Sus scale's "Real af" expands to a swear word and never
  appears in store media.
- Light theme on the host, no personal account visible in the host chrome, and only fixture or
  anonymised accounts in frame. Never a real person's account under a badge.
- At least one "Likely bot" badge with its hover card open, so the reasons and the "This can be
  wrong:" line are readable.

| File                | What it shows                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `01-x.png`          | X home timeline with a "Likely bot" badge and its hover card open                               |
| `02-reddit.png`     | A Reddit comment thread with a badge in the post credit bar and one in a comment meta row       |
| `03-bluesky.png`    | A Bluesky feed with an "Unsure" badge and a "Declared bot" badge next to the host's own robot    |
| `04-popup.png`      | The popup: policy status line, per-platform toggles, conservative mode, privacy sentence         |
| `05-options.png`    | The options page: platforms, lookups, badges (label style), feedback, policy                     |

The Chrome Web Store also takes an optional 440x280 small promo tile and a 1400x560 marquee; make
them from `../icon-512.png` on the brand teal (#0b6e6a) with no text, since there is no wordmark yet.
