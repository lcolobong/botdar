/**
 * One measured page load for the performance benchmark: an init script records long tasks, polls
 * the badge count and samples animation frames inside the page, and CDP's Performance domain
 * supplies the renderer's CPU and heap counters. Every run returns plain numbers; run.ts takes the
 * medians. The probe runs identically with and without the extension, so its own small cost cancels
 * out of the deltas.
 */
import type { BrowserContext, CDPSession, Page } from "playwright";

/** Flat per-run numbers; null when a run has nothing to report, such as badge times on a bare run. */
export type RunMetrics = Record<string, number | null>;

export interface RunResult {
  readonly metrics: RunMetrics;
  /** Longest gap between animation frames in each of the ten scroll steps, in ms. */
  readonly scrollStepFrameGapsMs: number[];
}

export interface MeasureOptions {
  readonly url: string;
  /** CDP CPU slowdown factor for the page's renderer; 1 runs at this machine's speed. */
  readonly cpuThrottleRate: number;
  /** Markup appended to `insertInto` after settling, to time badges on live insertion. */
  readonly liveInsertion?: { readonly markup: string; readonly insertInto: string };
}

interface ProbeState {
  readonly now: number;
  readonly count: number;
  readonly firstChangeAt: number | null;
  readonly lastChangeAt: number | null;
}

interface LongTask {
  readonly start: number;
  readonly duration: number;
}

interface PerfProbe {
  readonly longTasks: LongTask[];
  /** Starts a new badge window: changes are timed from the count at this moment. */
  markBadges(): void;
  state(): ProbeState;
  startFrames(): void;
  markStep(): void;
  stopFrames(): { frames: number[]; steps: number[] };
}

type ProbeWindow = Window & { __perfProbe?: PerfProbe };

const BADGE_POLL_MS = 50;
const STABLE_FOR_MS = 1_000;
/** The X fixture fetches its timeline body until 1.5 s after load; every run waits past that. */
const MIN_SETTLE_AFTER_LOAD_MS = 2_500;
const MIN_SETTLE_AFTER_INSERT_MS = 1_000;
const SETTLE_TIMEOUT_MS = 20_000;
const SETTLE_POLL_MS = 100;
const SCROLL_STEPS = 10;
const SCROLL_PAUSE_MS = 300;
const LONG_TASK_BLOCKING_MS = 50;

/** Serialised into the page by addInitScript, so it must not reference anything outside itself. */
function installProbe(pollMs: number): void {
  const longTasks: LongTask[] = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks.push({ start: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: "longtask", buffered: true });
  // A Reddit badge mounted after an anchor inside a post's shadow root is invisible to a document query.
  const countBadges = (): number => {
    let count: number = document.querySelectorAll("botdar-badge").length;
    for (const host of document.querySelectorAll("shreddit-post, shreddit-comment")) {
      count += host.shadowRoot?.querySelectorAll("botdar-badge").length ?? 0;
    }
    return count;
  };
  let count = 0;
  let baseline = 0;
  let firstChangeAt: number | null = null;
  let lastChangeAt: number | null = null;
  setInterval(() => {
    const next: number = countBadges();
    if (next === count) return;
    count = next;
    lastChangeAt = performance.now();
    if (firstChangeAt === null && next !== baseline) firstChangeAt = lastChangeAt;
  }, pollMs);
  let frames: number[] = [];
  let steps: number[] = [];
  let recording = false;
  const onFrame = (time: number): void => {
    if (!recording) return;
    frames.push(time);
    requestAnimationFrame(onFrame);
  };
  (window as ProbeWindow).__perfProbe = {
    longTasks,
    markBadges: () => {
      baseline = count;
      firstChangeAt = null;
      lastChangeAt = null;
    },
    state: () => ({ now: performance.now(), count, firstChangeAt, lastChangeAt }),
    startFrames: () => {
      frames = [];
      steps = [performance.now()];
      recording = true;
      requestAnimationFrame(onFrame);
    },
    markStep: () => void steps.push(performance.now()),
    stopFrames: () => {
      recording = false;
      return { frames, steps: [...steps, performance.now()] };
    },
  };
}

async function readProbe(page: Page): Promise<ProbeState> {
  const state: ProbeState | undefined = await page.evaluate(() =>
    (window as ProbeWindow).__perfProbe?.state(),
  );
  if (state === undefined) throw new Error("perf probe missing: the init script did not run");
  return state;
}

async function readLongTasks(page: Page): Promise<LongTask[]> {
  return page.evaluate(() => (window as ProbeWindow).__perfProbe?.longTasks ?? []);
}

/** Waits until the badge count has held for a second and at least `minQuietMs` passed since `from`. */
async function waitForBadgesToSettle(
  page: Page,
  from: number,
  minQuietMs: number,
): Promise<ProbeState> {
  const deadline: number = Date.now() + SETTLE_TIMEOUT_MS;
  for (;;) {
    const state: ProbeState = await readProbe(page);
    const quietSince: number = Math.max(state.lastChangeAt ?? from, from);
    const settled: boolean =
      state.now - quietSince >= STABLE_FOR_MS && state.now - from >= minQuietMs;
    if (settled || Date.now() > deadline) return state;
    await page.waitForTimeout(SETTLE_POLL_MS);
  }
}

function blockingSummary(
  tasks: readonly LongTask[],
  from: number,
  to: number,
): { count: number; tbt: number } {
  const inWindow: LongTask[] = tasks.filter((task) => task.start >= from && task.start < to);
  const tbt: number = inWindow.reduce(
    (sum, task) => sum + Math.max(task.duration - LONG_TASK_BLOCKING_MS, 0),
    0,
  );
  return { count: inWindow.length, tbt };
}

async function cdpCounters(session: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await session.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
}

const secondsToMs = (seconds: number | undefined): number => (seconds ?? 0) * 1_000;

function badgeTimes(
  state: ProbeState,
  from: number,
): { first: number | null; last: number | null } {
  return {
    first: state.firstChangeAt === null ? null : state.firstChangeAt - from,
    last: state.lastChangeAt === null ? null : state.lastChangeAt - from,
  };
}

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
    await page.addInitScript(installProbe, BADGE_POLL_MS);
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
    };
  } finally {
    await page.close();
  }
}
