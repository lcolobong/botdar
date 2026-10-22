/**
 * Loads the built Chrome extension into Playwright's Chromium and screenshots its own pages and
 * the feed fixtures served by fixtureServer.ts, light and dark. It builds nothing: run
 * `pnpm build` first. Output is one PNG per scene plus a manifest.json; see scripts/smoke/README.md.
 *
 *   pnpm smoke -- [--out <dir>] [--theme light|dark|both] [--only x|reddit|bluesky|pages] [--headed]
 *
 * One-time setup: `pnpm smoke:setup` (installs Playwright's Chromium).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { BrowserContext, Worker } from "playwright";
import type { FixtureServer } from "./fixtureServer.ts";
import {
  hostResolverRules,
  smokeFeedScenes,
  smokePlatformIds,
  startFixtureServer,
} from "./fixtureServer.ts";
import type { SceneGroup, SceneRecord, SmokeTheme } from "./scenes.ts";
import { captureExtensionPage, captureFeed, extensionPageScenes, feedViewport } from "./scenes.ts";

interface SmokeOptions {
  readonly outDir: string;
  readonly themes: readonly SmokeTheme[];
  readonly groups: readonly SceneGroup[];
  readonly headed: boolean;
}

const buildDir: string = fileURLToPath(new URL("../../.output/chrome-mv3/", import.meta.url));
const serviceWorkerWaitMs = 15_000;
const allGroups: readonly SceneGroup[] = [...smokePlatformIds, "pages"];

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index: number = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function parseOptions(argv: readonly string[]): SmokeOptions {
  const theme: string = flagValue(argv, "--theme") ?? "both";
  if (theme !== "light" && theme !== "dark" && theme !== "both") {
    throw new Error(`--theme expects light, dark or both, got "${theme}"`);
  }
  const only: string | undefined = flagValue(argv, "--only");
  if (only !== undefined && !allGroups.includes(only as SceneGroup)) {
    throw new Error(`--only expects one of ${allGroups.join(", ")}, got "${only}"`);
  }
  return {
    outDir: resolve(flagValue(argv, "--out") ?? ".output/smoke"),
    themes: theme === "both" ? ["light", "dark"] : [theme],
    groups: only === undefined ? allGroups : [only as SceneGroup],
    headed: argv.includes("--headed"),
  };
}

async function launchWithExtension(
  userDataDir: string,
  fixturePort: number,
  headed: boolean,
): Promise<BrowserContext> {
  const extensionDir: string = buildDir.replace(/\/$/, "");
  return chromium.launchPersistentContext(userDataDir, {
    // The headless shell cannot load extensions; the full Chromium build in new headless mode can.
    channel: "chromium",
    headless: !headed,
    ignoreHTTPSErrors: true,
    deviceScaleFactor: 2,
    viewport: feedViewport,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      `--host-resolver-rules=${hostResolverRules(fixturePort)}`,
      "--ignore-certificate-errors",
    ],
  });
}

async function resolveExtensionId(context: BrowserContext): Promise<string> {
  const worker: Worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: serviceWorkerWaitMs }));
  return new URL(worker.url()).hostname;
}

async function captureAll(
  context: BrowserContext,
  extensionId: string,
  options: SmokeOptions,
): Promise<SceneRecord[]> {
  const records: SceneRecord[] = [];
  for (const theme of options.themes) {
    for (const group of options.groups) {
      if (group === "pages") {
        for (const pageScene of extensionPageScenes) {
          records.push(
            await captureExtensionPage(
              context,
              extensionId,
              buildDir,
              pageScene,
              theme,
              options.outDir,
            ),
          );
        }
        continue;
      }
      for (const feedScene of smokeFeedScenes) {
        if (feedScene.platform === group) {
          records.push(...(await captureFeed(context, feedScene, theme, options.outDir)));
        }
      }
    }
  }
  return records;
}

function report(records: readonly SceneRecord[]): void {
  for (const record of records) {
    const detail: string = record.reason === undefined ? "" : ` (${record.reason})`;
    if (record.status === "skipped") {
      console.warn(`skip     ${record.file}${detail}`);
    } else {
      process.stdout.write(`captured ${record.file}${detail}\n`);
    }
  }
}

async function main(): Promise<void> {
  const options: SmokeOptions = parseOptions(process.argv.slice(2));
  if (!existsSync(join(buildDir, "manifest.json"))) {
    throw new Error(`no Chrome build at ${buildDir}; run pnpm build first`);
  }
  mkdirSync(options.outDir, { recursive: true });
  const userDataDir: string = mkdtempSync(join(tmpdir(), "botdar-smoke-"));
  const server: FixtureServer = await startFixtureServer();
  let context: BrowserContext | undefined;
  try {
    context = await launchWithExtension(userDataDir, server.port, options.headed);
    const extensionId: string = await resolveExtensionId(context);
    process.stdout.write(`extension ${extensionId} from ${buildDir}\n`);
    const records: SceneRecord[] = await captureAll(context, extensionId, options);
    report(records);
    const manifest = {
      generatedAt: new Date().toISOString(),
      extensionId,
      buildDir,
      themes: options.themes,
      scenes: records,
    };
    writeFileSync(join(options.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`wrote ${join(options.outDir, "manifest.json")}\n`);
  } finally {
    await context?.close();
    await server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
