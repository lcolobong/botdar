import { fakeBrowser } from "wxt/testing/fake-browser";
import { FEEDBACK_STORAGE_KEY } from "@/src/core/feedback";
import {
  LOOKUP_INDEX_KEY,
  LOOKUP_KEY_PREFIX,
  LOOKUP_MAX_ENTRIES,
  LOOKUP_SALT_KEY,
  LOOKUP_TTL_MS,
  NON_EMPTY_BIO_PLACEHOLDER,
  PersistedLookupStore,
  SWEEP_DEBOUNCE_MS,
} from "@/src/core/persistedLookups";
import type { PartialSignals } from "@/src/core/types";

const START = Date.UTC(2026, 9, 26);
let clock = START;
const store = (): PersistedLookupStore => new PersistedLookupStore(() => clock);

async function lookupKeys(): Promise<string[]> {
  const everything: Record<string, unknown> = await fakeBrowser.storage.local.get(null);
  return Object.keys(everything).filter((key) => key.startsWith(LOOKUP_KEY_PREFIX));
}

async function storedSalt(): Promise<unknown> {
  return (await fakeBrowser.storage.local.get(LOOKUP_SALT_KEY))[LOOKUP_SALT_KEY];
}

async function signalsFor(
  lookups: PersistedLookupStore,
  handle = "someone",
): Promise<PartialSignals | undefined> {
  return (await lookups.read("x", handle))?.signals;
}

beforeEach(() => {
  fakeBrowser.reset();
  clock = START;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PersistedLookupStore", () => {
  it("round-trips a snapshot and drops the display name", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "Someone", { followers: 12, displayName: "Some One" });

    expect(await signalsFor(lookups)).toEqual({ followers: 12 });
  });

  it("stores neither the handle, the display name nor any bio text", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "someone", {
      followers: 12,
      displayName: "Some One",
      bio: "contact me at https://example.com/@someone",
    });

    const dump: string = JSON.stringify(await fakeBrowser.storage.local.get(null));
    for (const secret of ["someone", "Some One", "example.com", "contact"]) {
      expect(dump).not.toContain(secret);
    }
    expect(await lookupKeys()).toHaveLength(1);
  });

  it("keeps whether the bio is empty, which is all the scorers read", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "empty", { bio: "   " });
    await lookups.write("x", "filled", { bio: "hello" });

    expect(await signalsFor(lookups, "empty")).toEqual({ bio: "" });
    expect(await signalsFor(lookups, "filled")).toEqual({ bio: NON_EMPTY_BIO_PLACEHOLDER });
  });

  it("keys by platform as well as handle", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "same", { followers: 1 });

    expect(await lookups.read("reddit", "same")).toBeUndefined();
  });

  it("generates the salt once, reuses it and reads it from storage once per instance", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "a", { followers: 1 });
    const first: unknown = await storedSalt();
    const getSpy = vi.spyOn(fakeBrowser.storage.local, "get");
    await lookups.write("x", "b", { followers: 2 });
    await lookups.read("x", "a");

    const saltReads: number = getSpy.mock.calls.filter(
      ([query]) => query === LOOKUP_SALT_KEY,
    ).length;

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await storedSalt()).toBe(first);
    expect(saltReads).toBe(0);
  });

  it("picks up a salt rotated by another context", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "someone", { followers: 1 });

    await fakeBrowser.storage.local.set({ [LOOKUP_SALT_KEY]: "rotated-elsewhere" });

    expect(await lookups.read("x", "someone")).toBeUndefined();
  });

  it("reports the remaining life and expires entries seven days after the fetch, deleting them", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "someone", { followers: 12 });

    clock = START + LOOKUP_TTL_MS - 1;
    expect((await lookups.read("x", "someone"))?.remainingMs).toBe(1);
    clock = START + LOOKUP_TTL_MS;
    expect(await lookups.read("x", "someone")).toBeUndefined();
    expect(await lookupKeys()).toHaveLength(0);
  });

  it("treats a fetch time in the future as expired", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "someone", { followers: 12 });

    clock = START - 1;

    expect(await lookups.read("x", "someone")).toBeUndefined();
  });

  it("ignores malformed stored values and drops tampered ones", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "someone", { followers: 12 });
    const [key] = await lookupKeys();
    await fakeBrowser.storage.local.set({
      [key as string]: {
        fetchedAt: START,
        tier: 2,
        signals: {
          followers: "many",
          evil: 1,
          bio: "raw text",
          verified: "supreme",
          declaredBy: "me",
          country: "x".repeat(1000),
          appStore: "App Store",
          hasDefaultAvatar: true,
        },
      },
    });

    expect(await signalsFor(lookups)).toEqual({ appStore: "App Store", hasDefaultAvatar: true });
    await fakeBrowser.storage.local.set({ [key as string]: "junk" });
    expect(await lookups.read("x", "someone")).toBeUndefined();
  });

  it("rotates the salt on clear so old entries cannot be matched, and keeps feedback", async () => {
    const lookups: PersistedLookupStore = store();
    await fakeBrowser.storage.local.set({ [FEEDBACK_STORAGE_KEY]: [{ handle: "someone" }] });
    await lookups.write("x", "someone", { followers: 12 });
    await lookups.sweep();
    const saltBefore: unknown = await storedSalt();

    await lookups.clear();

    expect(await lookupKeys()).toHaveLength(0);
    expect(await storedSalt()).not.toBe(saltBefore);
    expect(await fakeBrowser.storage.local.get(LOOKUP_INDEX_KEY)).toEqual({});
    expect(await lookups.read("x", "someone")).toBeUndefined();
    await lookups.write("x", "someone", { followers: 3 });
    expect(await signalsFor(lookups)).toEqual({ followers: 3 });
    expect(
      (await fakeBrowser.storage.local.get(FEEDBACK_STORAGE_KEY))[FEEDBACK_STORAGE_KEY],
    ).toEqual([{ handle: "someone" }]);
  });

  it("clears entries missing from the index too", async () => {
    await fakeBrowser.storage.local.set({
      [`${LOOKUP_KEY_PREFIX}orphan`]: { fetchedAt: START, tier: 2, signals: {} },
    });

    await store().clear();

    expect(await lookupKeys()).toHaveLength(0);
  });
});

describe("PersistedLookupStore.sweep", () => {
  it("sweeps expired entries and leaves other keys alone", async () => {
    const lookups: PersistedLookupStore = store();
    await fakeBrowser.storage.local.set({ "settings.v1": { a: 1 } });
    await lookups.write("x", "old", { followers: 1 });
    clock = START + LOOKUP_TTL_MS;
    await lookups.write("x", "fresh", { followers: 2 });

    await lookups.sweep();

    expect(await signalsFor(lookups, "fresh")).toEqual({ followers: 2 });
    expect(await lookupKeys()).toHaveLength(1);
    expect((await fakeBrowser.storage.local.get("settings.v1"))["settings.v1"]).toEqual({ a: 1 });
  });

  it("keeps the newest entries when over the cap", async () => {
    const lookups: PersistedLookupStore = store();
    const entries: Record<string, unknown> = {};
    for (let index = 0; index < LOOKUP_MAX_ENTRIES + 3; index += 1) {
      entries[`${LOOKUP_KEY_PREFIX}${index}`] = {
        fetchedAt: START + index,
        tier: 2,
        signals: { followers: index },
      };
    }
    await fakeBrowser.storage.local.set(entries);
    clock = START + LOOKUP_MAX_ENTRIES + 10;

    await lookups.sweep();

    const remaining: string[] = await lookupKeys();
    expect(remaining).toHaveLength(LOOKUP_MAX_ENTRIES);
    expect(remaining).not.toContain(`${LOOKUP_KEY_PREFIX}0`);
    expect(remaining).toContain(`${LOOKUP_KEY_PREFIX}${LOOKUP_MAX_ENTRIES + 2}`);
  });

  it("uses the index instead of scanning storage once it exists", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.write("x", "someone", { followers: 1 });
    await lookups.sweep();
    const getSpy = vi.spyOn(fakeBrowser.storage.local, "get");

    clock = START + 1000;
    await lookups.write("x", "another", { followers: 2 });
    await lookups.sweep();

    expect(getSpy.mock.calls.some(([query]) => query === null)).toBe(false);
    const stored: Record<string, { entries: Record<string, number> }> =
      await fakeBrowser.storage.local.get(LOOKUP_INDEX_KEY);
    expect(Object.keys(stored[LOOKUP_INDEX_KEY]?.entries ?? {})).toHaveLength(2);
  });

  it("rebuilds a missing index from a scan and expires entries the index never knew", async () => {
    await fakeBrowser.storage.local.set({
      [`${LOOKUP_KEY_PREFIX}orphan`]: {
        fetchedAt: START - LOOKUP_TTL_MS - 1,
        tier: 2,
        signals: {},
      },
      [`${LOOKUP_KEY_PREFIX}fresh`]: { fetchedAt: START, tier: 2, signals: {} },
    });

    await store().sweep();

    expect(await lookupKeys()).toEqual([`${LOOKUP_KEY_PREFIX}fresh`]);
  });

  it("rebuilds the index once it is older than the TTL, catching unindexed entries", async () => {
    const lookups: PersistedLookupStore = store();
    await lookups.sweep();
    await fakeBrowser.storage.local.set({
      [`${LOOKUP_KEY_PREFIX}unindexed`]: { fetchedAt: START, tier: 2, signals: {} },
    });

    clock = START + LOOKUP_TTL_MS;
    await lookups.sweep();

    expect(await lookupKeys()).toHaveLength(0);
  });

  it("sweeps by itself shortly after a write", async () => {
    vi.useFakeTimers();
    try {
      const lookups: PersistedLookupStore = store();
      await lookups.write("x", "someone", { followers: 1 });
      await vi.advanceTimersByTimeAsync(SWEEP_DEBOUNCE_MS);

      const stored: Record<string, unknown> = await fakeBrowser.storage.local.get(LOOKUP_INDEX_KEY);
      expect(stored[LOOKUP_INDEX_KEY]).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
