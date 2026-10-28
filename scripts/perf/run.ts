/**
 * Page-performance benchmark: serves the large feed fixtures from generateFixtures.ts under the real
 * hostnames and loads each one in two Chrome for Testing instances, one with the built extension
 * and one bare, alternating runs so drift hits both alike. Each fixture gets one unrecorded warm-up
 * per browser, then `--runs` measured loads each (see measure.ts). Writes results.json with every
 * run and results.md with the medians and the extension-minus-bare deltas. It builds nothing: run
 * `pnpm build` first.
 *
 * With --profile, one more extension run per fixture records a CPU profile from navigation to
 * settle and writes <fixture>.cpuprofile (opens in Chrome DevTools) and <fixture>-profile.md.
 *
 *   pnpm perf -- [--out <dir>] [--runs 5] [--only <fixture id>] [--cpu-throttle 4] [--headed]
 *                  [--build <dir>] [--profile]
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, CDPSession, Page } from "playwright";
import { fixtureUrl } from "../smoke/fixtureFiles.ts";
import type { FixtureServer } from "../smoke/fixtureServer.ts";
import { startFixtureServer } from "../smoke/fixtureServer.ts";
import { smokeHostnames } from "../smoke/sceneTable.ts";
import { buildDir, flagValue, launchChrome, resolveExtensionId } from "../smoke/run.ts";
import { redditFeedPosts } from "./fixtures/reddit.ts";
import type { MeasureOptions, RunResult } from "./measure.ts";
import { measureRun } from "./measure.ts";
import type { Condition, PerfScene } from "./perfScenes.ts";
import { conditions, insertedPostCount, perfRoutes, perfScenes } from "./perfScenes.ts";
import { extensionCosts, profileReport } from "./profile.ts";
import type { SceneResults } from "./report.ts";
import { format, markdownReport, medians } from "./report.ts";

interface PerfOptions {
  readonly outDir: string;
  readonly runs: number;
  readonly only: string | undefined;
  readonly headed: boolean;
  readonly buildDir: string;
  readonly cpuThrottleRate: number;
  readonly profile: boolean;
}

const perfViewport = { width: 1280, height: 800 } as const;
/** The extension opens its onboarding tab on install; it is closed before anything is measured. */
const onboardingWaitMs = 1_500;
function parseOptions(argv: readonly string[]): PerfOptions {
  const runs = Number(flagValue(argv, "--runs") ?? "5");
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs expects a positive integer`);
  const only: string | undefined = flagValue(argv, "--only");
  if (only !== undefined && !perfScenes.some((scene) => scene.scene === only)) {
    throw new Error(`--only expects one of ${perfScenes.map((scene) => scene.scene).join(", ")}`);
  }
  return {
    outDir: resolve(flagValue(argv, "--out") ?? ".output/perf"),
    runs,
    only,
    headed: argv.includes("--headed"),
    buildDir: resolve(flagValue(argv, "--build") ?? buildDir),
    cpuThrottleRate: Number(flagValue(argv, "--cpu-throttle") ?? "1"),
    profile: argv.includes("--profile"),
  };
}

async function closeExtraPages(context: BrowserContext): Promise<void> {
  await new Promise((done) => setTimeout(done, onboardingWaitMs));
  for (const page of context.pages()) {
    if (page.url().startsWith("chrome-extension://")) await page.close();
  }
}

async function browserVersion(context: BrowserContext): Promise<string> {
  const page: Page = await context.newPage();
  const session: CDPSession = await context.newCDPSession(page);
  const { product } = await session.send("Browser.getVersion");
  await page.close();
  return product;
}

async function measureScene(
  contexts: Record<Condition, BrowserContext>,
  scene: PerfScene,
  options: PerfOptions,
): Promise<SceneResults> {
  const measure: MeasureOptions = {
    url: fixtureUrl(scene),
    cpuThrottleRate: options.cpuThrottleRate,
    ...(scene.liveInsertion === true
      ? {
          liveInsertion: {
            markup: redditFeedPosts(insertedPostCount, 4_242, 300),
            insertInto: "shreddit-feed",
          },
        }
      : {}),
  };
  const collected: Record<Condition, RunResult[]> = { extension: [], bare: [] };
  for (const condition of conditions) await measureRun(contexts[condition], measure);
  for (let run = 1; run <= options.runs; run += 1) {
    for (const condition of conditions) {
      const result: RunResult = await measureRun(contexts[condition], measure);
      collected[condition].push(result);
      const { loadMs, tbtMs, badges } = result.metrics;
      process.stdout.write(
        `${scene.scene} ${condition} run ${run}: load ${format(loadMs)} ms, TBT ${format(tbtMs)} ms, ${badges} badges\n`,
      );
    }
  }
  if (options.profile) {
    const { profile } = await measureRun(contexts.extension, { ...measure, profile: true });
    if (profile !== undefined) {
      writeFileSync(join(options.outDir, `${scene.scene}.cpuprofile`), JSON.stringify(profile));
      const report: string = profileReport(scene.scene, extensionCosts(profile));
      writeFileSync(join(options.outDir, `${scene.scene}-profile.md`), report);
    }
  }
  return {
    scene: scene.scene,
    url: measure.url,
    fixture: scene.fixturePath,
    runs: collected,
    medians: { extension: medians(collected.extension), bare: medians(collected.bare) },
  };
}

async function main(): Promise<void> {
  const options: PerfOptions = parseOptions(process.argv.slice(2));
  if (!existsSync(join(options.buildDir, "manifest.json"))) {
    throw new Error(`no Chrome build at ${options.buildDir}; run pnpm build first`);
  }
  mkdirSync(options.outDir, { recursive: true });
  const server: FixtureServer = await startFixtureServer(0, perfRoutes);
  const userDataDirs: string[] = conditions.map(() => mkdtempSync(join(tmpdir(), "botdar-perf-")));
  const launched: BrowserContext[] = [];
  try {
    const launch = async (index: number, extensionDir: string | null): Promise<BrowserContext> => {
      const userDataDir: string = userDataDirs[index] ?? tmpdir();
      const context: BrowserContext = await launchChrome({
        userDataDir,
        fixturePort: server.port,
        headed: options.headed,
        extensionDir,
        viewport: perfViewport,
        deviceScaleFactor: 2,
      });
      launched.push(context);
      return context;
    };
    const contexts: Record<Condition, BrowserContext> = {
      extension: await launch(0, options.buildDir),
      bare: await launch(1, null),
    };
    process.stdout.write(
      `extension ${await resolveExtensionId(contexts.extension)} from ${options.buildDir}\n`,
    );
    await closeExtraPages(contexts.extension);
    const environment: Record<string, string | number> = {
      generatedAt: new Date().toISOString(),
      browser: await browserVersion(contexts.bare),
      mode: options.headed ? "headed" : "headless",
      cpu: cpus()[0]?.model ?? "unknown",
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 1_073_741_824),
      os: `${platform()} ${release()}`,
      runsPerCondition: options.runs,
      cpuThrottle: `${options.cpuThrottleRate}x`,
      viewport: `${perfViewport.width}x${perfViewport.height} at 2x`,
      hosts: Object.values(smokeHostnames).join(", "),
    };
    const all: SceneResults[] = [];
    for (const scene of perfScenes) {
      if (options.only === undefined || options.only === scene.scene)
        all.push(await measureScene(contexts, scene, options));
    }
    writeFileSync(
      join(options.outDir, "results.json"),
      `${JSON.stringify({ environment, scenes: all }, null, 2)}\n`,
    );
    writeFileSync(join(options.outDir, "results.md"), markdownReport(all, environment));
    process.stdout.write(`wrote ${join(options.outDir, "results.json")} and results.md\n`);
  } finally {
    for (const context of launched) await context.close();
    await server.close();
    for (const dir of userDataDirs) rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
