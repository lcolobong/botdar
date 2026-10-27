# Store screenshots

Both stores take 1280x800 PNGs. The smoke harness captures them; see the command below.

Rules for every capture:

- The plain label style (the default). The Sus scale's "Real af" expands to a swear word and never
  appears in store media.
- Light theme on the host (the Bluesky capture is the one deliberate dark frame), no personal
  account visible in the host chrome, and only fixture or anonymised accounts in frame. Never a
  real person's account under a badge.
- At least one "Likely bot" badge with its hover card open, so the reasons and the "This can be
  wrong:" line are readable.

| File                       | Caption                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `01-x-feed-card.png`       | Badges only when something stands out. Hover for the reasons.                        |
| `02-bluesky-dark-card.png` | Works on Bluesky too, in light and dark. Every card names the innocent explanation.  |
| `03-reddit-declared.png`   | Accounts that label themselves as automated get a "Declared bot" badge.              |
| `04-options.png`           | Switch platforms on or off, pick a label style, or keep to what the page shows.      |
| `05-popup.png`             | Computed in your browser. Profile lookups go only to the platform; nothing to us.    |

Regenerate all five with:

```bash
pnpm build && pnpm smoke -- --only store --viewport 1280x800 --out store/screenshots
```

The three feed captures are served from `tests/fixtures/store/` (realistic pages with the same authors
as the recorded fixtures); the popup and options captures seed a fetched policy first, so they read
"Policy updated today" and "Version 1, signature verified".

Then delete the `popup-alone.png` and `manifest.json` it also writes. Each file is 1280x800 at
device scale 1, RGB without alpha.

The Chrome Web Store also takes an optional 440x280 small promo tile and a 1400x560 marquee; make
them from `../icon-512.png` on the brand teal (#0b6e6a) with no text, since there is no wordmark yet.
