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
      "In-feed badges that show when a post's author displays patterns common in automated accounts, with reasons. Nothing about the accounts you see leaves your browser.",
    permissions: ["storage", "alarms"],
    host_permissions: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://www.reddit.com/*",
      "https://old.reddit.com/*",
      "https://bsky.app/*",
    ],
    browser_specific_settings: {
      gecko: {
        id: "botdar@lcolobong.github.io",
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["none"] },
      },
    },
  },
});
