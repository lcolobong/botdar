/**
 * Local HTTPS server that serves saved platform markup under the real hostnames so the extension's
 * content scripts, whose host permissions are limited to x.com, www.reddit.com and bsky.app, run
 * against it. Chrome is pointed at it with --host-resolver-rules (see hostResolverRules) and
 * --ignore-certificate-errors; the certificate under cert/ is self-signed and test-only.
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

export type SmokePlatformId = "x" | "reddit" | "bluesky";

export const smokePlatformIds: readonly SmokePlatformId[] = ["x", "reddit", "bluesky"];

/** The hostnames the content scripts are allowed to run on; the server answers for all three. */
export const smokeHostnames: Readonly<Record<SmokePlatformId, string>> = {
  x: "x.com",
  reddit: "www.reddit.com",
  bluesky: "bsky.app",
};

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
}

export const smokeFeedScenes: readonly SmokeFeedScene[] = [
  { platform: "x", scene: "feed", path: "/home" },
  { platform: "reddit", scene: "feed", path: "/" },
  {
    platform: "reddit",
    scene: "comments",
    path: "/r/woodworking/comments/1k9x2ab/finished_the_walnut_side_table/",
    fixtureFile: "comments.html",
    note: "quiet feed: every author in the recorded thread scores typical, so no badge is expected",
  },
  { platform: "bluesky", scene: "feed", path: "/" },
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
 * Recorded pages in order of preference: a feed over a thread, because a thread's authors all
 * score typical and draw nothing; X calls its feed a timeline. Anything else serves alphabetically.
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
    platform: "bluesky",
    path: "/xrpc/app.bsky.feed.getTimeline",
    file: "tests/fixtures/bluesky/get-timeline.json",
  },
  {
    platform: "bluesky",
    path: "/xrpc/app.bsky.actor.getProfiles",
    file: "tests/fixtures/bluesky/get-profiles.json",
  },
  // The recorded thread's OP. The other authors answer 404, so a capture shows both a profile
  // that was read and one that returned nothing.
  {
    platform: "reddit",
    path: "/user/quiet_lantern_4821/about.json",
    file: "tests/fixtures/reddit/about/normal.json",
  },
];

/**
 * Maps every fixture hostname to the local server. Everything else resolves to NOTFOUND so a
 * recorded page's leftover asset URLs fail fast instead of waiting on real DNS and networks.
 */
export function hostResolverRules(port: number): string {
  const mappings: string[] = Object.values(smokeHostnames).map(
    (hostname) => `MAP ${hostname} 127.0.0.1:${port}`,
  );
  return [...mappings, "MAP * ~NOTFOUND"].join(", ");
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
  const servesRequest = (route: { platform: SmokePlatformId; path: string }): boolean =>
    smokeHostnames[route.platform] === hostname && route.path === requestPath;
  // GET or POST alike: X posts some GraphQL operations and the interceptor relays both.
  const apiRoute: ApiFixtureRoute | undefined = routes.apiRoutes.find(servesRequest);
  if (apiRoute !== undefined) {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(readFileSync(new URL(apiRoute.file, repoRoot)));
    return;
  }
  const scene: SmokeFeedScene | undefined = routes.feedScenes.find(servesRequest);
  if (scene === undefined) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("no smoke fixture at this route");
    return;
  }
  const markup: string = readFileSync(resolveSceneFixture(scene, preferStore).path, "utf8");
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
      `  https://${smokeHostnames[route.platform]}${route.path} <- ${route.file}\n`,
    );
  }
  process.stdout.write(`chrome flag: --host-resolver-rules="${hostResolverRules(server.port)}"\n`);
}
