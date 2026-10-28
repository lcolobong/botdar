/**
 * One measured page load for the performance benchmark: the in-page probe (probe.ts) records long
 * tasks, the badge count and animation frames, and CDP's Performance domain supplies the
 * renderer's CPU and heap counters. Every run returns plain numbers; report.ts takes the medians.
 */
import type { BrowserContext, CDPSession, Page } from "playwright";
import type { LongTask, ProbeState, ProbeWindow } from "./probe.ts";
import {
  badgeTimes,
  blockingSummary,
  installProbeScript,
  readLongTasks,
  readProbe,
  waitForBadgesToSettle,
} from "./probe.ts";
import type { CpuProfile } from "./profile.ts";

/** Flat per-run numbers; null when a run has nothing to report, such as badge times on a bare run. */
export type RunMetrics = Record<string, number | null>;

export interface RunResult {
  readonly metrics: RunMetrics;
  /** Longest gap between animation frames in each of the ten scroll steps, in ms. */
  readonly scrollStepFrameGapsMs: number[];
  /** The CPU profile from navigation to settle, when the run asked for one. */
  readonly profile?: CpuProfile;
}

export interface MeasureOptions {
  readonly url: string;
  /** CDP CPU slowdown factor for the page's renderer; 1 runs at this machine's speed. */
  readonly cpuThrottleRate: number;
  /** Markup appended to `insertInto` after settling, to time badges on live insertion. */
  readonly liveInsertion?: { readonly markup: string; readonly insertInto: string };
  /** Samples the renderer's CPU profile every 100 µs from navigation until the badges settle. */
  readonly profile?: boolean;
}

/** The X fixture fetches its timeline body until 1.5 s after load; every run waits past that. */
const MIN_SETTLE_AFTER_LOAD_MS = 2_500;
const MIN_SETTLE_AFTER_INSERT_MS = 1_000;
const SCROLL_STEPS = 10;
const SCROLL_PAUSE_MS = 300;
const PROFILE_SAMPLING_US = 100;

async function cdpCounters(session: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await session.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
}

const secondsToMs = (seconds: number | undefined): number => (seconds ?? 0) * 1_000;

async function measureScroll(
  page: Page,
  session: CDPSession,
): Promise<{ metrics: RunMetrics; gaps: number[] }> {
  const scriptBefore: number = (await cdpCounters(session))["ScriptDuration"] ?? 0;
  const start: number = await page.evaluate(() => {
    (window as ProbeWindow).__perfProbe?.startFrames();
    return performance.now();
  });
  for (let step = 1; step <= SCROLL_STEPS; step += 1) {
    await page.evaluate((fraction: number) => {
      window.scrollTo(0, document.documentElement.scrollHeight * fraction);
      (window as ProbeWindow).__perfProbe?.markStep();
    }, step / SCROLL_STEPS);
    await page.waitForTimeout(SCROLL_PAUSE_MS);
  }
  const { frames, steps } = await page.evaluate(
    () => (window as ProbeWindow).__perfProbe?.stopFrames() ?? { frames: [], steps: [] },
  );
  const end: number = steps.at(-1) ?? start;
  const gaps: number[] = steps.slice(1, -1).map((stepStart, index) => {
    const stepEnd: number = steps[index + 2] ?? end;
    const stepFrames: number[] = [
      stepStart,
      ...frames.filter((time) => time > stepStart && time <= stepEnd),
    ];
    return Math.max(
      0,
      ...stepFrames.slice(1).map((time, frame) => time - (stepFrames[frame] ?? time)),
    );
  });
  const tasks: LongTask[] = await readLongTasks(page);
  const blocking = blockingSummary(tasks, start, end);
  const scriptAfter: number = (await cdpCounters(session))["ScriptDuration"] ?? 0;
  return {
    metrics: {
      scrollLongTasks: blocking.count,
      scrollTbtMs: blocking.tbt,
      scrollMaxFrameGapMs: Math.max(0, ...gaps),
      scrollScriptMs: secondsToMs(scriptAfter - scriptBefore),
    },
    gaps,
  };
}

async function measureInsertion(
  page: Page,
  insertion: NonNullable<MeasureOptions["liveInsertion"]>,
): Promise<RunMetrics> {
  const before: ProbeState = await readProbe(page);
  const insertedAt: number = await page.evaluate(({ markup, insertInto }) => {
    (window as ProbeWindow).__perfProbe?.markBadges();
    const holder: HTMLDivElement = document.createElement("div");
    // setHTMLUnsafe parses declarative shadow roots, which innerHTML would leave as inert templates.
    holder.setHTMLUnsafe(markup);
    document.querySelector(insertInto)?.append(...holder.children);
    return performance.now();
  }, insertion);
  const settled: ProbeState = await waitForBadgesToSettle(
    page,
    insertedAt,
    MIN_SETTLE_AFTER_INSERT_MS,
  );
  const tasks: LongTask[] = await readLongTasks(page);
  const blocking = blockingSummary(tasks, insertedAt, settled.now);
  const times = badgeTimes(settled, insertedAt);
  return {
    insertFirstBadgeMs: times.first,
    insertLastBadgeMs: times.last,
    insertNewBadges: settled.count - before.count,
    insertLongTasks: blocking.count,
    insertTbtMs: blocking.tbt,
  };
}

export async function measureRun(
  context: BrowserContext,
  options: MeasureOptions,
): Promise<RunResult> {
  const page: Page = await context.newPage();
  try {
    const session: CDPSession = await context.newCDPSession(page);
    await session.send("Performance.enable");
    if (options.cpuThrottleRate > 1) {
      await session.send("Emulation.setCPUThrottlingRate", { rate: options.cpuThrottleRate });
    }
    await installProbeScript(page);
    if (options.profile === true) {
      await session.send("Profiler.enable");
      await session.send("Profiler.setSamplingInterval", { interval: PROFILE_SAMPLING_US });
      await session.send("Profiler.start");
    }
    await page.goto(options.url, { waitUntil: "load" });
    const navigation = await page.evaluate(() => {
      const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      return {
        domContentLoaded: entry?.domContentLoadedEventEnd ?? 0,
        load: entry?.loadEventEnd ?? 0,
      };
    });
    const loaded: ProbeState = await waitForBadgesToSettle(
      page,
      navigation.load,
      MIN_SETTLE_AFTER_LOAD_MS,
    );
    const profile: CpuProfile | undefined =
      options.profile === true ? (await session.send("Profiler.stop")).profile : undefined;
    const counters: Record<string, number> = await cdpCounters(session);
    await session.send("HeapProfiler.collectGarbage");
    const heapUsed: number = (await cdpCounters(session))["JSHeapUsedSize"] ?? 0;
    const tasks: LongTask[] = await readLongTasks(page);
    const blocking = blockingSummary(tasks, 0, loaded.now);
    const times = badgeTimes(loaded, navigation.load);
    const scroll = await measureScroll(page, session);
    const insertion: RunMetrics =
      options.liveInsertion === undefined
        ? {}
        : await measureInsertion(page, options.liveInsertion);
    return {
      metrics: {
        domContentLoadedMs: navigation.domContentLoaded,
        loadMs: navigation.load,
        tbtMs: blocking.tbt,
        longTasks: blocking.count,
        scriptMs: secondsToMs(counters["ScriptDuration"]),
        taskMs: secondsToMs(counters["TaskDuration"]),
        layoutMs: secondsToMs(counters["LayoutDuration"]),
        recalcStyleMs: secondsToMs(counters["RecalcStyleDuration"]),
        heapMb: heapUsed / 1_048_576,
        firstBadgeMs: times.first,
        lastBadgeMs: times.last,
        badges: loaded.count,
        ...scroll.metrics,
        ...insertion,
      },
      scrollStepFrameGapsMs: scroll.gaps,
      ...(profile === undefined ? {} : { profile }),
    };
  } finally {
    await page.close();
  }
}
