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
  readonly kind: "recorded" | "placeholder";
}

const repoRoot: URL = new URL("../../", import.meta.url);
const certificateDir: URL = new URL("./cert/", import.meta.url);

/** The first recorded page under tests/fixtures/<platform>/html/ wins; the placeholder is the fallback. */
export function resolveFixture(platform: SmokePlatformId): FixtureSource {
  const recordedDir: string = fileURLToPath(new URL(`tests/fixtures/${platform}/html/`, repoRoot));
  if (existsSync(recordedDir)) {
    const recordedPage: string | undefined = readdirSync(recordedDir)
      .filter((name) => name.endsWith(".html"))
      .sort()[0];
    if (recordedPage !== undefined) {
      return { path: `${recordedDir}${recordedPage}`, kind: "recorded" };
    }
  }
  return {
    path: fileURLToPath(new URL(`tests/fixtures/smoke/${platform}.html`, repoRoot)),
    kind: "placeholder",
  };
}

export function fixtureUrl(platform: SmokePlatform): string {
  return `https://${platform.hostname}${platform.feedPath}`;
}

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
