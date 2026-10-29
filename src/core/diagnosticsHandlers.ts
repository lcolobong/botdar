/**
 * Answers the popup's diagnostics requests from inside a content script: the page's counters, and
 * the page's markup serialized and anonymised as a fixture for a bug report or a recording that
 * `pnpm capture` cannot make (a site the script cannot reach, a state only a scroll produced).
 */
import { diagnosticsSnapshot } from "./diagnostics.ts";
import type { SnapshotExportResponse } from "./messaging.ts";
import { onRequest } from "./messaging.ts";
import { anonymizeSnapshot, anonymizeUrl, describeAnonymization } from "./snapshot/anonymize.ts";
import type { AnonymizedSnapshot } from "./snapshot/anonymize.ts";
import { OWN_MARKUP } from "./botdarMarks.ts";
import { serializeDocument } from "./snapshot/serialize.ts";
import type { PlatformId } from "./types.ts";

function snapshotHeader(
  platform: PlatformId,
  source: string,
  date: string,
  anonymized: AnonymizedSnapshot | undefined,
): string {
  return [
    "<!--",
    `  Exported from ${source} on ${date} by the Botdar popup, platform ${platform}.`,
    `  ${describeAnonymization(anonymized)}`,
    "-->",
  ].join("\n");
}

export function exportSnapshot(
  platform: PlatformId,
  anonymize: boolean,
  now: number = Date.now(),
): SnapshotExportResponse {
  const raw: string = serializeDocument(document, OWN_MARKUP);
  const date: string = new Date(now).toISOString().slice(0, 10);
  const anonymized: AnonymizedSnapshot | undefined = anonymize
    ? anonymizeSnapshot(raw, platform)
    : undefined;
  const source: string = anonymize ? anonymizeUrl(location.href, platform) : location.href;
  const header: string = snapshotHeader(platform, source, date, anonymized);
  const body: string = anonymized?.html ?? raw;
  // Prepended, never substituted in: a header that depended on the serializer's exact first
  // line would vanish silently, and with it the "do not commit" warning on a raw export.
  return {
    html: `<!doctype html>\n${header}\n${body.replace(/^<!doctype html>\n/i, "")}`,
    fileName: `botdar-${platform}-${date}${anonymize ? "" : "-raw"}.html`,
    identifiers: anonymized?.handles ?? 0,
  };
}

/** Registers both handlers; returns the function that removes them. */
export function registerDiagnosticsHandlers(platform: PlatformId): () => void {
  const stopGet: () => void = onRequest("diagnostics.get", () => ({
    platform,
    stats: diagnosticsSnapshot(),
  }));
  const stopExport: () => void = onRequest("snapshot.export", (message) =>
    exportSnapshot(platform, message.anonymize),
  );
  return () => {
    stopGet();
    stopExport();
  };
}
