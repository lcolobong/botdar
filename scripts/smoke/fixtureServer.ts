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
import { readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import type { ApiFixtureRoute } from "./apiRoutes.ts";
import { apiFixtureRoutes } from "./apiRoutes.ts";
import type { FixtureSource } from "./fixtureFiles.ts";
import {
  fixtureUrl,
  repoRoot,
  resolveFixture,
  resolveSceneFixture,
  storeFixtureQuery,
} from "./fixtureFiles.ts";
import { recordedPageStyles } from "./pageStyles.ts";
import type { SmokeFeedScene, SmokePlatformId } from "./sceneTable.ts";
import { hackerNewsApiHostname, smokeFeedScenes, smokeHostnames } from "./sceneTable.ts";

const certificateDir: URL = new URL("./cert/", import.meta.url);

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
