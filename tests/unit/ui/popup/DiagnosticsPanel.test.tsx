// @vitest-environment happy-dom
import { render } from "preact";
import type { DiagnosticsStats } from "@/src/core/diagnostics";
import {
  DIAGNOSTICS_UNAVAILABLE,
  DiagnosticsPanel,
  RAW_EXPORT_CAPTION,
  describeSince,
  lookupsLine,
} from "@/src/ui/popup/DiagnosticsPanel";
import type { DiagnosticsPanelProps, DiagnosticsState } from "@/src/ui/popup/DiagnosticsPanel";

const NOW = Date.UTC(2026, 9, 25, 12, 0);

function stats(overrides: Partial<DiagnosticsStats> = {}): DiagnosticsStats {
  return {
    startedAt: NOW - 3 * 60_000,
    kinds: {
      post: { seen: 12, badged: 12, anchorMisses: 0 },
      comment: { seen: 40, badged: 0, anchorMisses: 40 },
      reply: { seen: 0, badged: 0, anchorMisses: 0 },
    },
    lookups: { started: 4, cached: 1, delivered: 3, empty: 0, rateLimited: 0, failed: 1 },
    ...overrides,
  };
}

function mount(
  state: DiagnosticsState,
  overrides: Partial<DiagnosticsPanelProps> = {},
): HTMLElement {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  render(
    <DiagnosticsPanel state={state} now={NOW} onExport={() => {}} {...overrides} />,
    container,
  );
  return container;
}

const cellTexts = (container: HTMLElement): string[][] =>
  Array.from(container.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent ?? ""),
  );

describe("DiagnosticsPanel", () => {
  it("shows the counts per kind, hides kinds with nothing found, and flags anchor misses", () => {
    const container: HTMLElement = mount({ status: "ready", platform: "reddit", stats: stats() });
    expect(container.querySelector(".bd-caption")?.textContent).toBe(
      "Reddit · Counting since the page loaded, 3 min ago",
    );
    expect(cellTexts(container)).toEqual([
      ["Posts", "12", "12", "0"],
      ["Comments", "40", "0", "40"],
    ]);
    expect(container.querySelector(".bd-table__warn")?.textContent).toBe("40");
    expect(container.textContent).toContain(
      "Lookups: 4 started · 1 cached · 3 delivered · 1 failed",
    );
    expect(container.textContent).toContain(RAW_EXPORT_CAPTION);
  });

  it("explains an unavailable page and disables the exports until the page answers", () => {
    const unavailable: HTMLElement = mount({ status: "unavailable" });
    expect(unavailable.textContent).toContain(DIAGNOSTICS_UNAVAILABLE);
    expect(unavailable.querySelector("table")).toBeNull();
    const buttons: HTMLButtonElement[] = Array.from(unavailable.querySelectorAll("button"));
    expect(buttons.map((button) => button.disabled)).toEqual([true, true]);
    expect(mount({ status: "loading" }).textContent).toContain("Asking the page…");
  });

  it("reports which export was asked for and shows the last export note", () => {
    const onExport = vi.fn();
    const container: HTMLElement = mount(
      { status: "ready", platform: "x", stats: stats() },
      { onExport, exportNote: "Saved botdar-x-2026-10-25.html" },
    );
    const [snapshot, raw] = Array.from(container.querySelectorAll("button"));
    snapshot?.click();
    raw?.click();
    expect(onExport.mock.calls).toEqual([[true], [false]]);
    expect(container.textContent).toContain("Saved botdar-x-2026-10-25.html");
    expect(container.textContent).not.toContain(RAW_EXPORT_CAPTION);
  });

  it("words the empty states", () => {
    const empty: DiagnosticsStats = stats({
      kinds: {
        post: { seen: 0, badged: 0, anchorMisses: 0 },
        comment: { seen: 0, badged: 0, anchorMisses: 0 },
        reply: { seen: 0, badged: 0, anchorMisses: 0 },
      },
      lookups: { started: 0, cached: 0, delivered: 0, empty: 0, rateLimited: 0, failed: 0 },
    });
    expect(lookupsLine(empty)).toBe("No profile lookups yet");
    expect(mount({ status: "ready", platform: "bluesky", stats: empty }).textContent).toContain(
      "Nothing found on this page yet.",
    );
    expect(describeSince(NOW - 10_000, NOW)).toBe(
      "Counting since the page loaded, under a minute ago",
    );
  });
});
