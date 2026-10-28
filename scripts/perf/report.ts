/**
 * Turns the per-run results of the page-performance benchmark into medians, the extension-minus-bare
 * deltas and the results.md tables.
 */
import type { RunMetrics, RunResult } from "./measure.ts";
import type { Condition } from "./perfScenes.ts";
import { conditions, insertedPostCount } from "./perfScenes.ts";

export interface SceneResults {
  readonly scene: string;
  readonly url: string;
  readonly fixture: string | undefined;
  readonly runs: Record<Condition, RunResult[]>;
  readonly medians: Record<Condition, RunMetrics>;
}

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

export function medians(runs: readonly RunResult[]): RunMetrics {
  const keys: Set<string> = new Set(runs.flatMap((run) => Object.keys(run.metrics)));
  return Object.fromEntries(
    [...keys].map((key) => [key, median(runs.map((run) => run.metrics[key]))]),
  );
}

export function format(value: number | null | undefined, signed = false): string {
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

export function markdownReport(
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
