/**
 * The in-page probe behind each measured load: an init script that records long tasks, polls the
 * badge count and samples animation frames, plus the Node-side readers and the settle wait. The
 * probe runs identically with and without the extension, so its own small cost cancels out of the
 * deltas.
 */
import type { Page } from "playwright";

export interface ProbeState {
  readonly now: number;
  readonly count: number;
  readonly firstChangeAt: number | null;
  readonly lastChangeAt: number | null;
}

export interface LongTask {
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

export type ProbeWindow = Window & { __perfProbe?: PerfProbe };

const BADGE_POLL_MS = 50;
const STABLE_FOR_MS = 1_000;
const SETTLE_TIMEOUT_MS = 20_000;
const SETTLE_POLL_MS = 100;
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

/** Registers the probe to run in every document the page loads, before the page's own scripts. */
export async function installProbeScript(page: Page): Promise<void> {
  await page.addInitScript(installProbe, BADGE_POLL_MS);
}

export async function readProbe(page: Page): Promise<ProbeState> {
  const state: ProbeState | undefined = await page.evaluate(() =>
    (window as ProbeWindow).__perfProbe?.state(),
  );
  if (state === undefined) throw new Error("perf probe missing: the init script did not run");
  return state;
}

export async function readLongTasks(page: Page): Promise<LongTask[]> {
  return page.evaluate(() => (window as ProbeWindow).__perfProbe?.longTasks ?? []);
}

/** Waits until the badge count has held for a second and at least `minQuietMs` passed since `from`. */
export async function waitForBadgesToSettle(
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

export function blockingSummary(
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

export function badgeTimes(
  state: ProbeState,
  from: number,
): { first: number | null; last: number | null } {
  return {
    first: state.firstChangeAt === null ? null : state.firstChangeAt - from,
    last: state.lastChangeAt === null ? null : state.lastChangeAt - from,
  };
}
