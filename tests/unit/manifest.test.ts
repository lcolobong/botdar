import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the ADR-0013 manifest invariants on the real build output. WXT adds
 * `web_accessible_resources` by itself for content scripts that use `cssInjectionMode: "ui"`, so
 * only the built manifest can prove the invariant holds; CI runs `pnpm build` before the tests.
 */

const MANIFEST_PATH: string = resolve(process.cwd(), ".output/chrome-mv3/manifest.json");

const DOCUMENTED_HOST_PERMISSIONS: readonly string[] = [
  "https://x.com/*",
  "https://twitter.com/*",
  "https://www.reddit.com/*",
  "https://old.reddit.com/*",
  "https://bsky.app/*",
];

const builtManifestMissing: boolean = !existsSync(MANIFEST_PATH);

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
});
