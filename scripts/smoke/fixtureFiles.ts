/**
 * Which saved page a smoke scene serves and the URL it is served at: the recorded page under
 * tests/fixtures/<platform>/html/, the store-listing page, or the hand-written placeholder.
 */
import { existsSync, readdirSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { SmokeFeedScene, SmokePlatformId } from "./sceneTable.ts";
import { smokeHostnames } from "./sceneTable.ts";
import type { FixtureKind } from "./sceneTypes.ts";

export interface FixtureSource {
  readonly path: string;
  /** The same file relative to the repository root, for the manifest. */
  readonly file: string;
  readonly kind: FixtureKind;
}

/** Query parameter that makes the server answer with the store-listing page instead of the recording. */
export const storeFixtureQuery = "fixture=store";

export const repoRoot: URL = new URL("../../", import.meta.url);

/**
 * Recorded pages in order of preference: a feed over a thread, because the feed carries more
 * badge tiers; X calls its feed a timeline. Anything else serves alphabetically.
 */
const preferredRecordedPages: readonly string[] = ["feed.html", "timeline.html"];

function repoRelative(path: string): string {
  return relative(fileURLToPath(repoRoot), path);
}

/**
 * With `preferStore`, the realistic store-listing page tests/fixtures/store/<platform>.html when it
 * exists; otherwise the named or else the preferred recorded page under
 * tests/fixtures/<platform>/html/, with the placeholder as the fallback when nothing is recorded.
 */
export function resolveFixture(
  platform: SmokePlatformId,
  fixtureFile?: string,
  preferStore = false,
): FixtureSource {
  const storePath: string = fileURLToPath(
    new URL(`tests/fixtures/store/${platform}.html`, repoRoot),
  );
  if (preferStore && existsSync(storePath)) {
    return { path: storePath, file: repoRelative(storePath), kind: "store" };
  }
  const recordedDir: string = fileURLToPath(new URL(`tests/fixtures/${platform}/html/`, repoRoot));
  if (existsSync(recordedDir)) {
    const recordedPages: string[] = readdirSync(recordedDir)
      .filter((name) => name.endsWith(".html"))
      .sort();
    const recordedPage: string | undefined =
      fixtureFile ??
      preferredRecordedPages.find((name) => recordedPages.includes(name)) ??
      recordedPages[0];
    if (recordedPage !== undefined) {
      const path = `${recordedDir}${recordedPage}`;
      return { path, file: repoRelative(path), kind: "recorded" };
    }
  }
  const path: string = fileURLToPath(new URL(`tests/fixtures/smoke/${platform}.html`, repoRoot));
  return { path, file: repoRelative(path), kind: "placeholder" };
}

/** The page a scene serves: its fixturePath when it names one, else the recorded or store page. */
export function resolveSceneFixture(scene: SmokeFeedScene, preferStore = false): FixtureSource {
  if (scene.fixturePath === undefined) {
    return resolveFixture(scene.platform, scene.fixtureFile, preferStore);
  }
  const path: string = fileURLToPath(new URL(scene.fixturePath, repoRoot));
  return { path, file: scene.fixturePath, kind: "recorded" };
}

export function fixtureUrl(scene: SmokeFeedScene, preferStore = false): string {
  const query: string = preferStore ? `?${storeFixtureQuery}` : "";
  return `https://${smokeHostnames[scene.platform]}${scene.path}${query}`;
}
