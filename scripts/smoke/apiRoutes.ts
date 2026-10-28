/**
 * The recorded API bodies the fixture server answers with, at the paths the platforms' web apps
 * fetch them from.
 */
import type { SmokePlatformId } from "./sceneTable.ts";
import { hackerNewsApiHostname } from "./sceneTable.ts";

export interface ApiFixtureRoute {
  readonly platform: SmokePlatformId;
  /** The request path the real web app would use; the fixture pages fetch exactly this. */
  readonly path: string;
  /** The recorded response body, relative to the repository root. */
  readonly file: string;
  /**
   * An API on a host of its own, answered with the CORS header that admits the platform's page,
   * as the real API does; without it the route is on the platform's own host.
   */
  readonly hostname?: string;
}

/**
 * Recorded API bodies served at the paths the web apps fetch, so the extension's MAIN-world
 * interceptor relays them and Tier 1 scoring runs in the captures. The X query id is made up:
 * the interceptor matches any id of the right shape and only the operation name matters.
 */
export const apiFixtureRoutes: readonly ApiFixtureRoute[] = [
  {
    platform: "x",
    path: "/i/api/graphql/SMOKEQUERYID00000001/HomeTimeline",
    file: "tests/fixtures/x/graphql/home-timeline-core.json",
  },
  {
    platform: "x",
    path: "/i/api/graphql/SMOKEQUERYID00000002/AboutAccountQuery",
    file: "tests/fixtures/smoke/x-about-account.json",
  },
  {
    platform: "x",
    path: "/i/api/graphql/SMOKEQUERYID00000003/UserTweets",
    file: "tests/fixtures/smoke/x-user-tweets.json",
  },
  {
    platform: "x",
    path: "/i/api/graphql/SMOKEQUERYID00000004/UserTweetsAndReplies",
    file: "tests/fixtures/smoke/x-user-tweets-and-replies.json",
  },
  {
    platform: "bluesky",
    path: "/xrpc/app.bsky.feed.getTimeline",
    file: "tests/fixtures/bluesky/get-timeline.json",
  },
  {
    platform: "bluesky",
    path: "/xrpc/app.bsky.actor.getProfiles",
    file: "tests/fixtures/bluesky/get-profiles.json",
  },
  {
    platform: "bluesky",
    path: "/xrpc/app.bsky.feed.getAuthorFeed",
    file: "tests/fixtures/smoke/bluesky-author-feed.json",
  },
  // The recorded thread's OP. The other authors answer 404, so a capture shows both a profile
  // that was read and one that returned nothing.
  {
    platform: "reddit",
    path: "/user/quiet_lantern_4821/about.json",
    file: "tests/fixtures/reddit/about/normal.json",
  },
  // The two copiers in the copied-replies scene and the last linker in the shared-links scene:
  // accounts two weeks old, hand-written bodies.
  ...["quick_fern_2291", "bright_sail_8803", "tidal_quill_5530"].map((handle): ApiFixtureRoute => ({
    platform: "reddit",
    path: `/user/${handle}/about.json`,
    file: `tests/fixtures/smoke/reddit-about-${handle}.json`,
  })),
  // The same OP's overview, asked for on hover: a hand-written listing of three items, the oldest
  // from October 2025, so the card gains the karma-since-first-activity line.
  {
    platform: "reddit",
    path: "/user/quiet_lantern_4821/overview.json",
    file: "tests/fixtures/reddit/overview/short.json",
  },
  // Three authors on the first screens of the recorded thread and front page, with bodies
  // hand-written in the recorded shape; every other author answers null, as an unknown id does.
  ...["tomas_bakes28", "jonas_draws01", "priya_draws51"].map((handle): ApiFixtureRoute => ({
    platform: "hackernews",
    hostname: hackerNewsApiHostname,
    path: `/v0/user/${handle}.json`,
    file: `tests/fixtures/hackernews/firebase/smoke/${handle}.json`,
  })),
  // The innertube lookup a hover makes, answered for every handle with the recorded commenter's
  // About panel (13 years, four videos), so whichever badge is hovered reads it.
  {
    platform: "youtube",
    path: "/youtubei/v1/navigation/resolve_url",
    file: "tests/fixtures/youtube/innertube/resolve-url.json",
  },
  {
    platform: "youtube",
    path: "/youtubei/v1/browse",
    file: "tests/fixtures/youtube/innertube/browse-about.json",
  },
];
