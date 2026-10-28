import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the ADR-0013 manifest invariants (as amended on 2026-10-27) on the real build output. WXT
 * adds `web_accessible_resources` by itself for content scripts that use `cssInjectionMode: "ui"`,
 * so only the built manifest can prove the invariant holds; CI and the release workflow run
 * `pnpm build` and `pnpm build:firefox` before the tests.
 */

const MANIFEST_PATH: string = resolve(process.cwd(), ".output/chrome-mv3/manifest.json");
/** What AMO receives: the Firefox build, whose gecko settings carry the data-collection declaration. */
const FIREFOX_MANIFEST_PATH: string = resolve(process.cwd(), ".output/firefox-mv2/manifest.json");

const DOCUMENTED_HOST_PERMISSIONS: readonly string[] = [
  "https://x.com/*",
  "https://twitter.com/*",
  "https://www.reddit.com/*",
  "https://old.reddit.com/*",
  "https://bsky.app/*",
  "https://news.ycombinator.com/*",
  "https://www.youtube.com/*",
];

const builtManifestMissing: boolean = !existsSync(MANIFEST_PATH);
const firefoxManifestMissing: boolean = !existsSync(FIREFOX_MANIFEST_PATH);

const STORE_README_PATH: string = resolve(process.cwd(), "store/README.md");
/** The Chrome Web Store caps the short description, which it takes from the manifest description. */
const MAX_DESCRIPTION_LENGTH = 132;

/** The fenced block under "Short description" in store/README.md, the listing copy of the description. */
function storeShortDescription(): string | undefined {
  const readme: string = readFileSync(STORE_README_PATH, "utf8");
  return /### Short description[^\n]*\n+```\n([^\n]+)\n```/.exec(readme)?.[1];
}

describe("built manifest", () => {
  it.skipIf(builtManifestMissing)(
    "has no web_accessible_resources and exactly the documented host permissions (skipped until `pnpm build` has produced .output/chrome-mv3)",
    () => {
      const manifest: Record<string, unknown> = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
      expect(manifest).not.toHaveProperty("web_accessible_resources");
      expect(manifest.host_permissions).toEqual(DOCUMENTED_HOST_PERMISSIONS);
      expect(manifest.permissions).toEqual(["storage", "alarms"]);
    },
  );

  it.skipIf(builtManifestMissing)(
    "runs a content script on Hacker News and asks no permission for its Firebase API (ADR-0026)",
    () => {
      const manifest: { content_scripts?: Array<{ matches?: string[] }> } = JSON.parse(
        readFileSync(MANIFEST_PATH, "utf8"),
      );
      const matches: string[] = (manifest.content_scripts ?? []).flatMap(
        (script) => script.matches ?? [],
      );
      expect(matches).toContain("https://news.ycombinator.com/*");
      expect(JSON.stringify(manifest)).not.toContain("firebaseio.com");
    },
  );

  it.skipIf(builtManifestMissing)(
    "has the store listing's short description, within the store's length cap",
    () => {
      const manifest: { description?: string } = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
      expect(manifest.description).toBe(storeShortDescription());
      expect(manifest.description?.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    },
  );

  it.skipIf(firefoxManifestMissing)(
    "declares to Firefox that the Tier 2 lookups transmit website content and nothing else (skipped until `pnpm build:firefox` has produced .output/firefox-mv2)",
    () => {
      const manifest: {
        browser_specific_settings?: {
          gecko?: { data_collection_permissions?: { required?: string[]; optional?: string[] } };
        };
      } = JSON.parse(readFileSync(FIREFOX_MANIFEST_PATH, "utf8"));
      expect(manifest.browser_specific_settings?.gecko?.data_collection_permissions).toEqual({
        required: ["websiteContent"],
      });
    },
  );

  it.skipIf(builtManifestMissing)(
    "runs a content script on www.youtube.com only, whose innertube lookups are same-origin (ADR-0030)",
    () => {
      const manifest: {
        content_scripts?: Array<{ matches?: string[] }>;
        host_permissions?: string[];
      } = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
      const matches: string[] = (manifest.content_scripts ?? []).flatMap(
        (script) => script.matches ?? [],
      );
      expect(matches).toContain("https://www.youtube.com/*");
      const youTubeHosts: string[] = [...matches, ...(manifest.host_permissions ?? [])].filter(
        (pattern) => pattern.includes("youtube") || pattern.includes("youtu.be"),
      );
      expect(new Set(youTubeHosts)).toEqual(new Set(["https://www.youtube.com/*"]));
    },
  );
});
