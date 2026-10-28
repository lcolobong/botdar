import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";

// Host permissions are listed explicitly: no <all_urls>, and no web_accessible_resources,
// so hostile pages cannot fingerprint the extension by probing its bundled files.
export default defineConfig({
  srcDir: ".",
  outDir: ".output",
  vite: () => ({ plugins: [preact()] }),
  manifest: {
    name: "Botdar",
    description:
      "A badge on each author on X, Reddit, Bluesky, Hacker News and YouTube for patterns common in automated accounts. Nothing sent to us.",
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    action: {
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
    },
    permissions: ["storage", "alarms"],
    host_permissions: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://www.reddit.com/*",
      "https://old.reddit.com/*",
      "https://bsky.app/*",
      // The Hacker News Firebase API (hacker-news.firebaseio.com) needs no entry: it answers the
      // page's origin with access-control-allow-origin, so the content script reaches it as is.
      "https://news.ycombinator.com/*",
      // YouTube's channel lookups go to the same origin's innertube API (/youtubei/v1/), so this one
      // entry covers the comment pages and the lookups.
      "https://www.youtube.com/*",
    ],
    browser_specific_settings: {
      gecko: {
        id: "botdar@lcolobong.github.io",
        strict_min_version: "128.0",
        // Mozilla counts any data handled outside the browser as transmission (extensionworkshop.com,
        // "Firefox built-in data consent"): the Tier 2 lookups send author names to each platform.
        data_collection_permissions: { required: ["websiteContent"] },
      },
    },
  },
});
