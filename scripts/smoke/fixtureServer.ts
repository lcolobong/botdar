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

export interface SmokePlatform {
  readonly id: SmokePlatformId;
  readonly hostname: string;
  /** A path the real site uses for a feed, so routing in the content script sees a familiar URL. */
  readonly feedPath: string;
}

export const smokePlatforms: readonly SmokePlatform[] = [
  { id: "x", hostname: "x.com", feedPath: "/home" },
  {
    id: "reddit",
    hostname: "www.reddit.com",
    feedPath: "/r/botdarsmoke/comments/sm0ke1/placeholder_thread/",
  },
  { id: "bluesky", hostname: "bsky.app", feedPath: "/" },
];

export interface FixtureSource {
  readonly path: string;
  /** The same file relative to the repository root, for the manifest. */
  readonly file: string;
  readonly kind: "recorded" | "placeholder";
}

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

/** The preferred recorded page under tests/fixtures/<platform>/html/; the placeholder is the fallback. */
export function resolveFixture(platform: SmokePlatformId): FixtureSource {
  const recordedDir: string = fileURLToPath(new URL(`tests/fixtures/${platform}/html/`, repoRoot));
  if (existsSync(recordedDir)) {
    const recordedPages: string[] = readdirSync(recordedDir)
      .filter((name) => name.endsWith(".html"))
      .sort();
    const recordedPage: string | undefined =
      preferredRecordedPages.find((name) => recordedPages.includes(name)) ?? recordedPages[0];
    if (recordedPage !== undefined) {
      const path = `${recordedDir}${recordedPage}`;
      return { path, file: repoRelative(path), kind: "recorded" };
    }
  }
  const path: string = fileURLToPath(new URL(`tests/fixtures/smoke/${platform}.html`, repoRoot));
  return { path, file: repoRelative(path), kind: "placeholder" };
}

export function fixtureUrl(platform: SmokePlatform): string {
  return `https://${platform.hostname}${platform.feedPath}`;
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
];

/**
 * Maps every fixture hostname to the local server. Everything else resolves to NOTFOUND so a
 * recorded page's leftover asset URLs fail fast instead of waiting on real DNS and networks.
 */
export function hostResolverRules(port: number): string {
  const mappings: string[] = smokePlatforms.map(
    (platform) => `MAP ${platform.hostname} 127.0.0.1:${port}`,
  );
  return [...mappings, "MAP * ~NOTFOUND"].join(", ");
}

export interface FixtureServer {
  readonly port: number;
  close(): Promise<void>;
}

function platformForRequest(request: IncomingMessage): SmokePlatform | undefined {
  const hostname: string = (request.headers.host ?? "").split(":")[0] ?? "";
  return smokePlatforms.find((platform) => platform.hostname === hostname);
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  const platform: SmokePlatform | undefined = platformForRequest(request);
  const requestPath: string = (request.url ?? "/").split("?")[0] ?? "/";
  // GET or POST alike: X posts some GraphQL operations and the interceptor relays both.
  const apiRoute: ApiFixtureRoute | undefined = apiFixtureRoutes.find(
    (route) => route.platform === platform?.id && route.path === requestPath,
  );
  if (apiRoute !== undefined) {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(readFileSync(new URL(apiRoute.file, repoRoot)));
    return;
  }
  if (platform === undefined || requestPath !== platform.feedPath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("no smoke fixture at this route");
    return;
  }
  const markup: string = readFileSync(resolveFixture(platform.id).path, "utf8");
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(markup);
}

export function startFixtureServer(port = 0): Promise<FixtureServer> {
  const server: Server = createServer(
    {
      key: readFileSync(new URL("smoke-test-only.key.pem", certificateDir)),
      cert: readFileSync(new URL("smoke-test-only.cert.pem", certificateDir)),
    },
    handleRequest,
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
  for (const platform of smokePlatforms) {
    process.stdout.write(`  ${fixtureUrl(platform)} <- ${resolveFixture(platform.id).path}\n`);
  }
  process.stdout.write(`chrome flag: --host-resolver-rules="${hostResolverRules(server.port)}"\n`);
}
