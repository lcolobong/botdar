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
import type { FixtureRoutes, FixtureServer } from "../smoke/fixtureServer.ts";
import { fixtureUrl } from "../smoke/fixtureFiles.ts";
import { startFixtureServer } from "../smoke/fixtureServer.ts";
import type { SmokeFeedScene } from "../smoke/sceneTable.ts";
import { smokeHostnames } from "../smoke/sceneTable.ts";
import { buildDir, flagValue, launchChrome, resolveExtensionId } from "../smoke/run.ts";
import { perfHomeTimelinePath, redditFeedPosts } from "./generateFixtures.ts";
import type { MeasureOptions, RunMetrics, RunResult } from "./measure.ts";
import { measureRun } from "./measure.ts";
import { extensionCosts, profileReport } from "./profile.ts";

type Condition = "extension" | "bare";

interface PerfScene extends SmokeFeedScene {
  /** Appends 50 more posts after settling and times their badges. */
  readonly liveInsertion?: boolean;
}

interface PerfOptions {
  readonly outDir: string;
  readonly runs: number;
  readonly only: string | undefined;
  readonly headed: boolean;
  readonly buildDir: string;
  readonly cpuThrottleRate: number;
  readonly profile: boolean;
}

interface SceneResults {
  readonly scene: string;
  readonly url: string;
  readonly fixture: string | undefined;
  readonly runs: Record<Condition, RunResult[]>;
  readonly medians: Record<Condition, RunMetrics>;
}

const conditions: readonly Condition[] = ["extension", "bare"];
const perfViewport = { width: 1280, height: 800 } as const;
/** The extension opens its onboarding tab on install; it is closed before anything is measured. */
const onboardingWaitMs = 1_500;
const insertedPostCount = 50;

const perfScene = (scene: string, platform: PerfScene["platform"], path: string): PerfScene => ({
  scene,
  platform,
  path,
  fixturePath: `tests/fixtures/perf/${scene}.html`,
});
const perfScenes: readonly PerfScene[] = [
  { ...perfScene("reddit-feed-300", "reddit", "/r/popular/"), liveInsertion: true },
  perfScene("reddit-comments-1500", "reddit", "/r/perf/comments/perf/thread/"),
  perfScene("x-timeline-400", "x", "/home"),
  perfScene("bluesky-feed-300", "bluesky", "/"),
];
const timelineBody = "tests/fixtures/perf/x-home-timeline-400.json";
const perfRoutes: FixtureRoutes = {
  feedScenes: perfScenes,
  apiRoutes: [{ platform: "x", path: perfHomeTimelinePath, file: timelineBody }],
};

/** Rows of the per-fixture tables, in order; keys a run did not produce are skipped. */
const metricLabels: ReadonlyArray<readonly [string, string]> = [
  ["domContentLoadedMs", "DOMContentLoaded (ms)"],
  ["loadMs", "load (ms)"],
  ["tbtMs", "Total Blocking Time, navigation to settle (ms)"],
  ["longTasks", "Long tasks, navigation to settle"],
  ["scriptMs", "Script, CDP ScriptDuration (ms)"],
  ["taskMs", "All tasks, CDP TaskDuration (ms)"],
  ["layoutMs", "Layout (ms)"],
  ["recalcStyleMs", "Style recalc (ms)"],
  ["heapMb", "JS heap after settle and GC (MB)"],
  ["firstBadgeMs", "First badge, after load (ms)"],
  ["lastBadgeMs", "Last badge, after load (ms)"],
  ["badges", "Badges mounted"],
  ["scrollLongTasks", "Scroll: long tasks"],
  ["scrollTbtMs", "Scroll: blocking time (ms)"],
  ["scrollMaxFrameGapMs", "Scroll: longest frame gap (ms)"],
  ["scrollScriptMs", "Scroll: script (ms)"],
  ["insertFirstBadgeMs", `Insert ${insertedPostCount}: first new badge (ms)`],
  ["insertLastBadgeMs", `Insert ${insertedPostCount}: last new badge (ms)`],
  ["insertNewBadges", `Insert ${insertedPostCount}: new badges`],
  ["insertLongTasks", `Insert ${insertedPostCount}: long tasks`],
  ["insertTbtMs", `Insert ${insertedPostCount}: blocking time (ms)`],
];
const summaryKeys: readonly string[] =
  "loadMs tbtMs scriptMs heapMb firstBadgeMs lastBadgeMs badges scrollLongTasks".split(" ");

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

function median(values: readonly (number | null | undefined)[]): number | null {
  const sorted: number[] = values
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle: number = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function medians(runs: readonly RunResult[]): RunMetrics {
  const keys: Set<string> = new Set(runs.flatMap((run) => Object.keys(run.metrics)));
  return Object.fromEntries(
    [...keys].map((key) => [key, median(runs.map((run) => run.metrics[key]))]),
  );
}

function format(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined) return "–";
  const digits: number = Math.abs(value) >= 100 || Number.isInteger(value) ? 0 : 1;
  const text: string = value.toFixed(digits);
  return signed && value > 0 ? `+${text}` : text;
}

function delta(results: SceneResults, key: string): number | null {
  const withExtension: number | null | undefined = results.medians.extension[key];
  const bare: number | null | undefined = results.medians.bare[key];
  return typeof withExtension === "number" && typeof bare === "number"
    ? withExtension - bare
    : null;
}

function markdownReport(
  all: readonly SceneResults[],
  environment: Record<string, string | number>,
): string {
  const lines: string[] = [
    "# Botdar page-performance benchmark",
    "",
    ...Object.entries(environment).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Summary (medians)",
    "",
    `| Fixture | Condition | ${summaryKeys.map((key) => metricLabels.find(([known]) => known === key)?.[1] ?? key).join(" | ")} |`,
    `| --- | --- | ${summaryKeys.map(() => "---:").join(" | ")} |`,
  ];
  for (const results of all) {
    for (const condition of conditions) {
      lines.push(
        `| ${results.scene} | ${condition} | ${summaryKeys.map((key) => format(results.medians[condition][key])).join(" | ")} |`,
      );
    }
    lines.push(
      `| ${results.scene} | delta | ${summaryKeys.map((key) => format(delta(results, key), true)).join(" | ")} |`,
    );
  }
  for (const results of all) {
    lines.push(
      "",
      `## ${results.scene}`,
      "",
      `Served as ${results.url} from ${results.fixture ?? "?"}.`,
      "",
    );
    lines.push("| Metric | Bare | Extension | Delta |", "| --- | ---: | ---: | ---: |");
    for (const [key, label] of metricLabels) {
      if (!(key in results.medians.extension) && !(key in results.medians.bare)) continue;
      const row: string[] = [
        label,
        format(results.medians.bare[key]),
        format(results.medians.extension[key]),
        format(delta(results, key), true),
      ];
      lines.push(`| ${row.join(" | ")} |`);
    }
  }
  return `${lines.join("\n")}\n`;
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
