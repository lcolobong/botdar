/**
 * Local HTTPS server that serves saved platform markup under the real hostnames so the extension's
 * content scripts, whose host permissions are limited to x.com, www.reddit.com, bsky.app,
 * news.ycombinator.com and www.youtube.com, run against it. Chrome is pointed at it with --host-resolver-rules (see
 * hostResolverRules) and --ignore-certificate-errors; the certificate under cert/ is self-signed
 * and test-only.
 *
 * One-time setup: `pnpm smoke:setup` (installs Playwright's Chromium).
 * Standalone: `node --experimental-strip-types scripts/smoke/fixtureServer.ts` prints the port.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type SmokePlatformId = "x" | "reddit" | "bluesky" | "hackernews" | "youtube";

export const smokePlatformIds: readonly SmokePlatformId[] = [
  "x",
  "reddit",
  "bluesky",
  "hackernews",
  "youtube",
];

/** The hostnames the content scripts are allowed to run on; the server answers for all of them. */
export const smokeHostnames: Readonly<Record<SmokePlatformId, string>> = {
  x: "x.com",
  reddit: "www.reddit.com",
  bluesky: "bsky.app",
  hackernews: "news.ycombinator.com",
  youtube: "www.youtube.com",
};

/** The Hacker News Firebase API, which the content script reaches cross-origin. */
export const hackerNewsApiHostname = "hacker-news.firebaseio.com";

export interface SmokeFeedScene {
  readonly platform: SmokePlatformId;
  /** Names the capture; "feed" is each platform's primary scene and its hover capture is "hover". */
  readonly scene: string;
  /** A path the real site uses for this page, so routing in the content script sees a familiar URL. */
  readonly path: string;
  /** A specific recorded page under tests/fixtures/<platform>/html/; otherwise the preferred one. */
  readonly fixtureFile?: string;
  /** A page anywhere in the repository, relative to its root; wins over fixtureFile. */
  readonly fixturePath?: string;
  /** Carried into the manifest, for a scene that is expected to draw nothing. */
  readonly note?: string;
  /**
   * Hover the badge mounted after this element (a CSS selector for the adapter's badge anchor)
   * instead of the most interesting badge on the page.
   */
  readonly hoverAnchor?: string;
}

export const smokeFeedScenes: readonly SmokeFeedScene[] = [
  { platform: "x", scene: "feed", path: "/home" },
  // The recorded timeline again, at a profile path where its script also fetches maria_dev's
  // About lookup, profile timeline and replies tab (hand-written bodies under tests/fixtures/smoke/).
  {
    platform: "x",
    scene: "profile",
    path: "/maria_dev",
    fixtureFile: "timeline.html",
    hoverAnchor: 'div:has(> a[href="/maria_dev"])',
  },
  { platform: "reddit", scene: "feed", path: "/" },
  {
    platform: "reddit",
    scene: "comments",
    path: "/r/woodworking/comments/1k9x2ab/finished_the_walnut_side_table/",
    fixtureFile: "comments.html",
  },
  // A hand-written thread where two new accounts post near copies of an earlier comment; their
  // profiles are served below, so the hover card on the later copier shows a full read.
  {
    platform: "reddit",
    scene: "copied-replies",
    path: "/r/woodworking/comments/1k9x2ab/walnut_table_copied_replies/",
    fixtureFile: "copied-replies.html",
    hoverAnchor: 'a[href="/user/Bright_Sail_8803/"]',
  },
  // A hand-written link post whose comments link one small site from six accounts; the last of
  // them has a profile served below, so its hover card shows a full read.
  {
    platform: "reddit",
    scene: "shared-links",
    path: "/r/harbourcity/comments/1kb4c7d/council_votes_to_close_the_harbour_street_bridge/",
    fixtureFile: "shared-links.html",
    hoverAnchor: 'a[href="/user/Tidal_Quill_5530/"]',
  },
  { platform: "bluesky", scene: "feed", path: "/" },
  // The feed page again, at a profile path where its script also fetches alice.example.com's
  // author feed (a hand-written body under tests/fixtures/smoke/).
  {
    platform: "bluesky",
    scene: "profile",
    path: "/profile/alice.example.com",
    fixtureFile: "feed.html",
    hoverAnchor: 'a[href="/profile/alice.example.com"]',
  },
  { platform: "hackernews", scene: "thread", path: "/item", fixtureFile: "thread.html" },
  { platform: "hackernews", scene: "front", path: "/", fixtureFile: "front.html" },
  // The recorded watch page. YouTube looks a commenter up on hover only, so the feed capture shows
  // the page alone and the hover capture the recorded commenter's About panel.
  {
    platform: "youtube",
    scene: "watch",
    path: "/watch",
    fixtureFile: "watch.html",
    hoverAnchor: 'a#author-text[href="/@jonas_reads12"]',
  },
];

export interface FixtureSource {
  readonly path: string;
  /** The same file relative to the repository root, for the manifest. */
  readonly file: string;
  readonly kind: "recorded" | "placeholder" | "store";
}

/** Query parameter that makes the server answer with the store-listing page instead of the recording. */
export const storeFixtureQuery = "fixture=store";

const repoRoot: URL = new URL("../../", import.meta.url);
const certificateDir: URL = new URL("./cert/", import.meta.url);

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

/**
 * Maps every fixture hostname to the local server. Everything else resolves to NOTFOUND so a
 * recorded page's leftover asset URLs fail fast instead of waiting on real DNS and networks.
 */
export function hostResolverRules(port: number): string {
  const mappings: string[] = [...Object.values(smokeHostnames), hackerNewsApiHostname].map(
    (hostname) => `MAP ${hostname} 127.0.0.1:${port}`,
  );
  return [...mappings, "MAP * ~NOTFOUND"].join(", ");
}

/**
 * A recording keeps no stylesheet (scripts/capture drops them), so a served Hacker News page would
 * render in browser defaults at twice the site's type size. This approximates news.css closely
 * enough for a capture to show the badge at the size it has on the site.
 */
const recordedPageStyles: Partial<Record<SmokePlatformId, string>> = {
  hackernews: [
    "body, td, input, textarea { font-family: Verdana, Geneva, sans-serif; font-size: 10pt; color: #828282; }",
    "#hnmain { background-color: #f6f6ef; width: 100%; }",
    "a { color: #000; text-decoration: none; }",
    ".pagetop, .pagetop a { color: #000; } .subtext, .subline, .subtext a { font-size: 7pt; color: #828282; }",
    ".comhead, .comhead a { font-size: 8pt; color: #828282; } .commtext { font-size: 9pt; color: #000; }",
    ".titleline { font-size: 10pt; } .rank { color: #828282; } .votearrow { width: 10px; height: 10px; }",
  ].join("\n"),
  // YouTube's page is mostly the player and the app's chrome; the capture keeps the creator's line
  // and the comments, in the site's type and avatar sizes.
  youtube: [
    "body { margin: 0; padding: 12px 16px; font: 14px Roboto, Arial, sans-serif; color: #0f0f0f; background: #fff; }",
    "html[dark] body { color: #f1f1f1; background: #0f0f0f; } a { color: inherit; text-decoration: none; }",
    "[hidden], ytd-masthead, #masthead-container, tp-yt-app-drawer, ytd-mini-guide-renderer, #player, #secondary,",
    "#title, #description, #actions, #subscribe-button, #action-buttons, #action-menu, ytd-comments-header-renderer,",
    "ytd-info-panel-content-renderer, tp-yt-paper-tooltip, #attributed-channel-name, #author-thumbnail img, #owner img,",
    "ytd-comment-simplebox-renderer, #expander > tp-yt-paper-button, ytd-continuation-item-renderer, #more-replies,",
    "#less-replies, ytd-button-renderer, ytd-popup-container, svg { display: none !important; }",
    "#owner { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-weight: 500; }",
    "#owner #avatar, #author-thumbnail-button { display: block; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; background: #d9d9d9; }",
    "#owner-sub-count { color: #606060; font-size: 12px; }",
    "#body { display: flex; gap: 12px; margin: 0 0 16px; } #author-thumbnail { flex: none; }",
    "#header-author { display: flex; align-items: center; gap: 4px; } #header-author h3 { margin: 0; font-size: 13px; font-weight: 500; }",
    "#published-time-text { color: #606060; font-size: 12px; } #content-text { display: block; margin-top: 2px; line-height: 20px; }",
    "ytd-comment-replies-renderer { display: block; margin-left: 56px; }",
  ].join("\n"),
};

function corsHeaders(route: ApiFixtureRoute): Record<string, string> {
  return route.hostname === undefined
    ? {}
    : { "access-control-allow-origin": `https://${smokeHostnames[route.platform]}` };
}

/** What a server answers: the smoke routes by default; the perf runner passes its own. */
export interface FixtureRoutes {
  readonly feedScenes: readonly SmokeFeedScene[];
  readonly apiRoutes: readonly ApiFixtureRoute[];
}

export const smokeFixtureRoutes: FixtureRoutes = {
  feedScenes: smokeFeedScenes,
  apiRoutes: apiFixtureRoutes,
};

export interface FixtureServer {
  readonly port: number;
  close(): Promise<void>;
}

function handleRequest(
  routes: FixtureRoutes,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const hostname: string = (request.headers.host ?? "").split(":")[0] ?? "";
  const [requestPath = "/", requestQuery = ""] = (request.url ?? "/").split("?");
  const preferStore: boolean = requestQuery === storeFixtureQuery;
  const servesRequest = (route: {
    platform: SmokePlatformId;
    path: string;
    hostname?: string;
  }): boolean =>
    (route.hostname ?? smokeHostnames[route.platform]) === hostname && route.path === requestPath;
  // GET or POST alike: X posts some GraphQL operations and the interceptor relays both.
  const apiRoute: ApiFixtureRoute | undefined = routes.apiRoutes.find(servesRequest);
  if (apiRoute !== undefined) {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(apiRoute),
    });
    response.end(readFileSync(new URL(apiRoute.file, repoRoot)));
    return;
  }
  if (hostname === hackerNewsApiHostname) {
    // Firebase answers an id with no account with a JSON null, not a 404.
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": `https://${smokeHostnames.hackernews}`,
    });
    response.end("null");
    return;
  }
  const scene: SmokeFeedScene | undefined = routes.feedScenes.find(servesRequest);
  if (scene === undefined) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("no smoke fixture at this route");
    return;
  }
  const recorded: string = readFileSync(resolveSceneFixture(scene, preferStore).path, "utf8");
  const pageStyle: string | undefined = recordedPageStyles[scene.platform];
  const markup: string =
    pageStyle === undefined
      ? recorded
      : recorded.replace("</head>", `<style>${pageStyle}</style></head>`);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(markup);
}

export function startFixtureServer(
  port = 0,
  routes: FixtureRoutes = smokeFixtureRoutes,
): Promise<FixtureServer> {
  const server: Server = createServer(
    {
      key: readFileSync(new URL("smoke-test-only.key.pem", certificateDir)),
      cert: readFileSync(new URL("smoke-test-only.cert.pem", certificateDir)),
    },
    (request, response) => handleRequest(routes, request, response),
  );
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address: AddressInfo = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const runAsScript: boolean =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runAsScript) {
  const server: FixtureServer = await startFixtureServer();
  process.stdout.write(`fixture server on 127.0.0.1:${server.port}\n`);
  for (const scene of smokeFeedScenes) {
    const fixture: FixtureSource = resolveFixture(scene.platform, scene.fixtureFile);
    process.stdout.write(`  ${fixtureUrl(scene)} <- ${fixture.file}\n`);
  }
  for (const route of apiFixtureRoutes) {
    process.stdout.write(
      `  https://${route.hostname ?? smokeHostnames[route.platform]}${route.path} <- ${route.file}\n`,
    );
  }
  process.stdout.write(`chrome flag: --host-resolver-rules="${hostResolverRules(server.port)}"\n`);
}
