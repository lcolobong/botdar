import { fakeBrowser } from "wxt/testing/fake-browser";
import type { FeedbackExport, FeedbackInput } from "@/src/core/feedback";
import {
  FEEDBACK_CAP,
  FEEDBACK_STORAGE_KEY,
  clearFeedback,
  exportFeedbackJson,
  isFeedbackEntry,
  listFeedback,
  recordFeedback,
  removeFeedback,
} from "@/src/core/feedback";

const input = (handle: string): FeedbackInput => ({
  platform: "x",
  handle,
  tier: "many",
  reasons: ["Account is 3 days old", "Replies make up 95% of posts"],
  computedAt: 1_700_000_000_000,
});

const readStored = async (): Promise<unknown> => {
  const stored: Record<string, unknown> = await fakeBrowser.storage.local.get(FEEDBACK_STORAGE_KEY);
  return stored[FEEDBACK_STORAGE_KEY];
};

describe("feedback store", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("records an entry with an id and timestamp under feedback.v1", async () => {
    const entry = await recordFeedback(input("bot_123456"), () => 42);

    expect(entry.id).toMatch(/[0-9a-f-]{36}/);
    expect(entry.recordedAt).toBe(42);
    expect(entry).toMatchObject(input("bot_123456"));
    expect(await readStored()).toEqual([entry]);
  });

  it("lists entries oldest first", async () => {
    await recordFeedback(input("first"));
    await recordFeedback(input("second"));

    const entries = await listFeedback();

    expect(entries.map((entry) => entry.handle)).toEqual(["first", "second"]);
  });

  it("keeps the newest entries when the cap is exceeded", async () => {
    const seeded = Array.from({ length: FEEDBACK_CAP }, (_, index) => ({
      ...input(`seed_${index}`),
      id: `id-${index}`,
      recordedAt: index,
    }));
    await fakeBrowser.storage.local.set({ [FEEDBACK_STORAGE_KEY]: seeded });

    await recordFeedback(input("newest"));

    const entries = await listFeedback();
    expect(entries).toHaveLength(FEEDBACK_CAP);
    expect(entries[0]?.handle).toBe("seed_1");
    expect(entries[FEEDBACK_CAP - 1]?.handle).toBe("newest");
  });

  it("removes one entry by id", async () => {
    const kept = await recordFeedback(input("kept"));
    const removed = await recordFeedback(input("removed"));

    expect(await removeFeedback(removed.id)).toBe(true);
    expect(await removeFeedback(removed.id)).toBe(false);
    expect((await listFeedback()).map((entry) => entry.id)).toEqual([kept.id]);
  });

  it("clears every entry", async () => {
    await recordFeedback(input("a"));
    await clearFeedback();

    expect(await listFeedback()).toEqual([]);
    expect(await readStored()).toBeUndefined();
  });

  it("drops malformed stored entries instead of throwing", async () => {
    const valid = { ...input("ok"), id: "id-ok", recordedAt: 1 };
    await fakeBrowser.storage.local.set({
      [FEEDBACK_STORAGE_KEY]: [valid, { id: "no-handle" }, "junk", null],
    });

    expect(await listFeedback()).toEqual([valid]);
  });

  it("treats a non-array value as empty", async () => {
    await fakeBrowser.storage.local.set({ [FEEDBACK_STORAGE_KEY]: { broken: true } });

    expect(await listFeedback()).toEqual([]);
  });

  it("does not share the reasons array with the caller", async () => {
    const reasons = ["one"];
    const entry = await recordFeedback({ ...input("x"), reasons });
    reasons.push("two");

    expect(entry.reasons).toEqual(["one"]);
  });

  it("exports pretty JSON with a schema header", async () => {
    const entry = await recordFeedback(input("exported"), () => 5);

    const json = await exportFeedbackJson(() => 1_700_000_000_000);

    expect(json).toContain("\n  ");
    const parsed: FeedbackExport = JSON.parse(json);
    expect(parsed.schema).toBe(1);
    expect(parsed.exportedAt).toBe("2023-11-14T22:13:20.000Z");
    expect(parsed.entries).toEqual([entry]);
  });

  it("validates entries field by field", () => {
    const valid = { ...input("ok"), id: "id", recordedAt: 1 };
    expect(isFeedbackEntry(valid)).toBe(true);
    expect(isFeedbackEntry({ ...valid, platform: "myspace" })).toBe(false);
    expect(isFeedbackEntry({ ...valid, tier: "certain" })).toBe(false);
    expect(isFeedbackEntry({ ...valid, reasons: ["a", 1] })).toBe(false);
    expect(isFeedbackEntry({ ...valid, computedAt: "now" })).toBe(false);
  });
});
