import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  LOOKUP_SWEEP_ALARM,
  sweepLookups,
  registerLookupSweep,
  scheduleLookupSweep,
} from "@/src/background/lookupSweep";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/src/core/settings";
import {
  LOOKUP_INDEX_KEY,
  LOOKUP_KEY_PREFIX,
  LOOKUP_TTL_MS,
  PersistedLookupStore,
} from "@/src/core/persistedLookups";

const NOW = Date.UTC(2026, 9, 26);
const expiredKey = `${LOOKUP_KEY_PREFIX}expired`;

async function seedExpiredLookup(): Promise<void> {
  await fakeBrowser.storage.local.set({
    [expiredKey]: { fetchedAt: NOW - LOOKUP_TTL_MS - 1, tier: 2, signals: {} },
  });
}

const storedKeys = async (): Promise<string[]> =>
  Object.keys(await fakeBrowser.storage.local.get(null));

beforeEach(() => {
  fakeBrowser.reset();
});

describe("scheduleLookupSweep", () => {
  it("registers one daily alarm", async () => {
    await scheduleLookupSweep();
    await scheduleLookupSweep();

    const alarms: { name: string; periodInMinutes?: number }[] = await fakeBrowser.alarms.getAll();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ name: LOOKUP_SWEEP_ALARM, periodInMinutes: 1440 });
  });
});

describe("registerLookupSweep", () => {
  it("sweeps on startup and when its alarm fires, not for other alarms", async () => {
    registerLookupSweep(new PersistedLookupStore(() => NOW));

    await seedExpiredLookup();
    await fakeBrowser.alarms.onAlarm.trigger({
      name: "unrelated",
      scheduledTime: NOW,
      persistAcrossSessions: true,
    });
    expect(await storedKeys()).toContain(expiredKey);

    await fakeBrowser.alarms.onAlarm.trigger({
      name: LOOKUP_SWEEP_ALARM,
      scheduledTime: NOW,
      persistAcrossSessions: true,
    });
    await vi.waitFor(async () => expect(await storedKeys()).not.toContain(expiredKey));

    await seedExpiredLookup();
    await fakeBrowser.storage.local.remove(LOOKUP_INDEX_KEY);
    await fakeBrowser.runtime.onStartup.trigger();
    await vi.waitFor(async () => expect(await storedKeys()).not.toContain(expiredKey));
    expect(await fakeBrowser.alarms.getAll()).toHaveLength(1);
  });
});

describe("sweepLookups", () => {
  it("drops every entry, even live ones, while persistLookups is off", async () => {
    const lookups = new PersistedLookupStore(() => NOW);
    await lookups.write("x", "someone", { followers: 1 });
    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { ...defaultSettings, persistLookups: false },
    });

    await sweepLookups(lookups);

    expect((await storedKeys()).filter((key) => key.startsWith(LOOKUP_KEY_PREFIX))).toEqual([]);
  });

  it("keeps live entries while persistLookups is on", async () => {
    const lookups = new PersistedLookupStore(() => NOW);
    await lookups.write("x", "someone", { followers: 1 });

    await sweepLookups(lookups);

    expect(await lookups.read("x", "someone")).toBeDefined();
  });
});
