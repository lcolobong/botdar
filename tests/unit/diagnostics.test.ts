// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  diagnosticsSnapshot,
  kindOfPost,
  recordAnchorMiss,
  recordBadged,
  recordLookup,
  recordSeen,
  resetDiagnostics,
} from "../../src/core/diagnostics";
import type { PostRef } from "../../src/core/types";

const element = (): Element => document.createElement("div");

function post(extra: Partial<PostRef> = {}): PostRef {
  return {
    element: element(),
    anchor: element(),
    ref: { platform: "reddit", handle: "someone" },
    isReply: false,
    ...extra,
  };
}

describe("diagnostics counters", () => {
  beforeEach(() => resetDiagnostics(1_000));

  it("starts empty with the reset time", () => {
    const stats = diagnosticsSnapshot();
    expect(stats.startedAt).toBe(1_000);
    expect(stats.kinds.post).toEqual({ seen: 0, badged: 0, anchorMisses: 0 });
    expect(stats.lookups.started).toBe(0);
  });

  it("counts an element once however many passes report it", () => {
    const item: Element = element();
    recordSeen("comment", item);
    recordSeen("comment", item);
    recordBadged("comment", item);
    recordBadged("comment", item);
    expect(diagnosticsSnapshot().kinds.comment).toEqual({ seen: 1, badged: 1, anchorMisses: 0 });
  });

  it("counts a retried anchor miss once and clears it when the element resolves", () => {
    const item: Element = element();
    recordAnchorMiss("post", item);
    recordAnchorMiss("post", item);
    expect(diagnosticsSnapshot().kinds.post).toEqual({ seen: 1, badged: 0, anchorMisses: 1 });
    recordSeen("post", item);
    expect(diagnosticsSnapshot().kinds.post).toEqual({ seen: 1, badged: 0, anchorMisses: 0 });
  });

  it("moves an item between kinds when it resolves under a different one", () => {
    const article: Element = element();
    recordAnchorMiss("post", article);
    recordSeen("reply", article);
    expect(diagnosticsSnapshot().kinds.post).toEqual({ seen: 0, badged: 0, anchorMisses: 0 });
    expect(diagnosticsSnapshot().kinds.reply).toEqual({ seen: 1, badged: 0, anchorMisses: 0 });
  });

  it("tallies lookup outcomes and returns copies", () => {
    recordLookup("started");
    recordLookup("delivered");
    recordLookup("rateLimited");
    const first = diagnosticsSnapshot();
    first.lookups.failed = 99;
    expect(diagnosticsSnapshot().lookups).toMatchObject({
      started: 1,
      delivered: 1,
      rateLimited: 1,
      failed: 0,
    });
  });

  it("derives the kind from a Reddit comment ref or the reply flag", () => {
    expect(kindOfPost(post({ kind: "comment" }))).toBe("comment");
    expect(kindOfPost(post({ kind: "post" }))).toBe("post");
    expect(kindOfPost(post({ isReply: true }))).toBe("reply");
    expect(kindOfPost(post())).toBe("post");
  });
});
