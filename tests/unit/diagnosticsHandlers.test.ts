// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/r/politics/comments/1xf6xqz/title/"}
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { recordSeen, resetDiagnostics } from "../../src/core/diagnostics";
import { exportSnapshot, registerDiagnosticsHandlers } from "../../src/core/diagnosticsHandlers";
import type { DiagnosticsGetResponse, SnapshotExportResponse } from "../../src/core/messaging";
import { fakeHandleFor } from "../../src/core/snapshot/anonymize";

const PAGE = `<shreddit-comment author="Real_Person"><div slot="commentMeta"><a href="https://www.reddit.com/user/Real_Person/">Real_Person</a></div></shreddit-comment>`;

describe("diagnostics handlers", () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    fakeBrowser.reset();
    resetDiagnostics(5);
    document.body.innerHTML = PAGE;
    stop = registerDiagnosticsHandlers("reddit");
  });

  afterEach(() => stop());

  it("answers diagnostics.get with the platform and the counters", async () => {
    const item: Element | null = document.querySelector("shreddit-comment");
    if (item === null) throw new Error("fixture missing");
    recordSeen("comment", item);
    const response = (await fakeBrowser.runtime.sendMessage({
      type: "diagnostics.get",
    })) as DiagnosticsGetResponse;
    expect(response.platform).toBe("reddit");
    expect(response.stats.startedAt).toBe(5);
    expect(response.stats.kinds.comment.seen).toBe(1);
  });

  it("answers snapshot.export with an anonymised fixture named for the platform and day", async () => {
    const response = (await fakeBrowser.runtime.sendMessage({
      type: "snapshot.export",
      anonymize: true,
    })) as SnapshotExportResponse;
    expect(response.fileName).toMatch(/^botdar-reddit-\d{4}-\d{2}-\d{2}\.html$/);
    expect(response.html.startsWith("<!doctype html>\n<!--")).toBe(true);
    expect(response.html).not.toContain("Real_Person");
    expect(response.html).toContain(fakeHandleFor("Real_Person", "reddit"));
    expect(response.html).toContain(`/comments/`);
    expect(response.html).not.toContain("1xf6xqz");
    expect(response.html.split("\n")[2]).toContain(
      "Exported from https://www.reddit.com/r/politics/comments/",
    );
    expect(response.identifiers).toBeGreaterThan(0);
  });

  it("keeps real names in a raw export and says so in the file name and header", () => {
    const raw: SnapshotExportResponse = exportSnapshot("reddit", false, Date.UTC(2026, 9, 25));
    expect(raw.fileName).toBe("botdar-reddit-2026-10-25-raw.html");
    expect(raw.html).toContain("NOT anonymised");
    expect(raw.html).toContain('author="Real_Person"');
    expect(raw.identifiers).toBe(0);
  });
});
