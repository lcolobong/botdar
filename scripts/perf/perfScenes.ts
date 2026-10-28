/**
 * The fixtures the page-performance benchmark measures: the large generated pages served under the
 * real hostnames, and the one API body (X's HomeTimeline) they fetch.
 */
import type { FixtureRoutes } from "../smoke/fixtureServer.ts";
import type { SmokeFeedScene } from "../smoke/sceneTable.ts";
import { perfHomeTimelinePath } from "./fixtures/x.ts";

export type Condition = "extension" | "bare";

export interface PerfScene extends SmokeFeedScene {
  /** Appends 50 more posts after settling and times their badges. */
  readonly liveInsertion?: boolean;
}

export const conditions: readonly Condition[] = ["extension", "bare"];
export const insertedPostCount = 50;

const perfScene = (scene: string, platform: PerfScene["platform"], path: string): PerfScene => ({
  scene,
  platform,
  path,
  fixturePath: `tests/fixtures/perf/${scene}.html`,
});
export const perfScenes: readonly PerfScene[] = [
  { ...perfScene("reddit-feed-300", "reddit", "/r/popular/"), liveInsertion: true },
  perfScene("reddit-comments-1500", "reddit", "/r/perf/comments/perf/thread/"),
  perfScene("x-timeline-400", "x", "/home"),
  perfScene("bluesky-feed-300", "bluesky", "/"),
];
const timelineBody = "tests/fixtures/perf/x-home-timeline-400.json";
export const perfRoutes: FixtureRoutes = {
  feedScenes: perfScenes,
  apiRoutes: [{ platform: "x", path: perfHomeTimelinePath, file: timelineBody }],
};
