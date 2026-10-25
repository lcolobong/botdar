import type { DiagnosticsKind, DiagnosticsStats, LookupOutcome } from "@/src/core/diagnostics";
import { DIAGNOSTICS_KINDS, LOOKUP_OUTCOMES } from "@/src/core/diagnostics";
import type { PlatformId } from "@/src/core/types";
import { PLATFORM_NAMES } from "../platforms";

export type DiagnosticsState =
  | { status: "loading" }
  /** No Botdar content script answered in the active tab. */
  | { status: "unavailable" }
  | { status: "ready"; platform: PlatformId; stats: DiagnosticsStats };

export interface DiagnosticsPanelProps {
  state: DiagnosticsState;
  /** The outcome of the last export, shown under the buttons. */
  exportNote?: string | undefined;
  now: number;
  onExport: (anonymize: boolean) => void;
}

export const DIAGNOSTICS_UNAVAILABLE = "Open a supported site to see what Botdar found there.";
export const RAW_EXPORT_CAPTION = "Raw keeps real usernames; share only the anonymised file.";

const KIND_LABELS: Record<DiagnosticsKind, string> = {
  post: "Posts",
  comment: "Comments",
  reply: "Replies",
};
const LOOKUP_LABELS: Record<LookupOutcome, string> = {
  started: "started",
  cached: "cached",
  delivered: "delivered",
  empty: "empty",
  rateLimited: "rate limited",
  failed: "failed",
};

/** Minutes are what matter while debugging a page; the popup is rarely open for longer. */
export function describeSince(startedAt: number, now: number): string {
  const minutes: number = Math.max(0, Math.floor((now - startedAt) / 60_000));
  if (minutes === 0) return "Counting since the page loaded, under a minute ago";
  return `Counting since the page loaded, ${minutes} min ago`;
}

export function lookupsLine(stats: DiagnosticsStats): string {
  const parts: string[] = LOOKUP_OUTCOMES.filter((outcome) => stats.lookups[outcome] > 0).map(
    (outcome) => `${stats.lookups[outcome]} ${LOOKUP_LABELS[outcome]}`,
  );
  return parts.length === 0 ? "No profile lookups yet" : `Lookups: ${parts.join(" · ")}`;
}

function CountsTable({ stats }: { stats: DiagnosticsStats }) {
  const kinds: DiagnosticsKind[] = DIAGNOSTICS_KINDS.filter((kind) => stats.kinds[kind].seen > 0);
  if (kinds.length === 0) {
    return <span class="bd-caption">Nothing found on this page yet.</span>;
  }
  return (
    <table class="bd-table" aria-label="What Botdar found on this page">
      <thead>
        <tr>
          <th scope="col"></th>
          <th scope="col">Found</th>
          <th scope="col">Badged</th>
          <th scope="col">No anchor</th>
        </tr>
      </thead>
      <tbody>
        {kinds.map((kind) => (
          <tr key={kind}>
            <th scope="row">{KIND_LABELS[kind]}</th>
            <td>{stats.kinds[kind].seen}</td>
            <td>{stats.kinds[kind].badged}</td>
            <td class={stats.kinds[kind].anchorMisses > 0 ? "bd-table__warn" : undefined}>
              {stats.kinds[kind].anchorMisses}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiagnosticsPanel({ state, exportNote, now, onExport }: DiagnosticsPanelProps) {
  const ready: boolean = state.status === "ready";
  const caption: string =
    state.status === "ready"
      ? `${PLATFORM_NAMES[state.platform]} · ${describeSince(state.stats.startedAt, now)}`
      : state.status === "loading"
        ? "Asking the page…"
        : DIAGNOSTICS_UNAVAILABLE;
  return (
    <section class="bd-diagnostics" aria-label="Diagnostics">
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Diagnostics</p>
          <span class="bd-caption">{caption}</span>
        </div>
      </div>
      {state.status === "ready" && (
        <div class="bd-diagnostics__body">
          <CountsTable stats={state.stats} />
          <span class="bd-caption">{lookupsLine(state.stats)}</span>
        </div>
      )}
      <div class="bd-diagnostics__foot">
        <div class="bd-row__actions">
          <button type="button" class="bd-btn" disabled={!ready} onClick={() => onExport(true)}>
            Export snapshot
          </button>
          <button type="button" class="bd-btn" disabled={!ready} onClick={() => onExport(false)}>
            Export raw
          </button>
        </div>
        <span class="bd-caption">{exportNote ?? RAW_EXPORT_CAPTION}</span>
      </div>
    </section>
  );
}
