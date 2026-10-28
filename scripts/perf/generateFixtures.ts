/**
 * Writes the large feed fixtures that scripts/perf/run.ts serves: a 300-post Reddit feed, a
 * 1,500-comment Reddit thread, a 400-post X timeline with its HomeTimeline body and a 300-post
 * Bluesky feed. Every item copies the markup shape of the hand-written fixtures under
 * tests/fixtures/<platform>/html/, so the content scripts read them the same way. The generator is
 * seeded, so the output only changes when this file, fixtures/kit.ts or a generator under
 * fixtures/ does; rerun `pnpm perf:fixtures` after changing any of them.
 *
 *   pnpm perf:fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { blueskyPost } from "./fixtures/bluesky.ts";
import type { Random } from "./fixtures/kit.ts";
import { page, seededRandom } from "./fixtures/kit.ts";
import { redditCommentsPage, redditFeedPosts } from "./fixtures/reddit.ts";
import { xTimeline } from "./fixtures/x.ts";

export const perfFixtureDir: URL = new URL("../../tests/fixtures/perf/", import.meta.url);

function writeFixture(name: string, contents: string): void {
  writeFileSync(new URL(name, perfFixtureDir), contents);
  process.stdout.write(
    `wrote tests/fixtures/perf/${name} (${Math.round(contents.length / 1024)} KiB)\n`,
  );
}

function main(): void {
  mkdirSync(perfFixtureDir, { recursive: true });
  writeFixture(
    "reddit-feed-300.html",
    page(
      "reddit",
      [
        "300 shreddit-post items in the shapes of tests/fixtures/reddit/html/feed.html; every tenth",
        "carries the APP tag.",
      ],
      `<shreddit-app><shreddit-feed id="main-feed">\n${redditFeedPosts(300, 300)}\n</shreddit-feed></shreddit-app>`,
    ),
  );
  writeFixture("reddit-comments-1500.html", redditCommentsPage(1500));
  const timeline = xTimeline(400, "x-home-timeline-400.json");
  writeFixture("x-timeline-400.html", timeline.html);
  writeFixture("x-home-timeline-400.json", timeline.body);
  const random: Random = seededRandom(300);
  writeFixture(
    "bluesky-feed-300.html",
    page(
      "Bluesky",
      [
        "300 feed items in the shape of tests/fixtures/bluesky/html/feed.html; every 20th carries",
        "Bluesky's robot badge. No API body is served, so only Tier 0 runs.",
      ],
      Array.from({ length: 300 }, (_, index) => blueskyPost(random, index)).join("\n"),
    ),
  );
}

const runAsScript: boolean =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runAsScript) main();
