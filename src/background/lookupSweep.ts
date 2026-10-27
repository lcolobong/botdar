/**
 * Keeps the persisted lookup cache tidy (ADR-0025): a sweep on install and browser start, and one
 * from a daily alarm, so an expired or over-cap entry never lingers for days on a quiet profile.
 */
import { browser } from "wxt/browser";
import { PersistedLookupStore } from "../core/persistedLookups.ts";
import { loadSettings } from "../core/settings.ts";

export const LOOKUP_SWEEP_ALARM = "botdar-lookup-sweep";
const SWEEP_PERIOD_MINUTES = 24 * 60;

/** Creates the daily alarm once; an existing alarm keeps its schedule across worker restarts. */
export async function scheduleLookupSweep(): Promise<void> {
  const existing: unknown = await browser.alarms.get(LOOKUP_SWEEP_ALARM);
  if (existing !== undefined) return;
  await browser.alarms.create(LOOKUP_SWEEP_ALARM, {
    periodInMinutes: SWEEP_PERIOD_MINUTES,
    delayInMinutes: SWEEP_PERIOD_MINUTES,
  });
}

/**
 * With persistLookups off nothing should remain, so the sweep also catches a write that was already
 * past its setting check when the options page wiped the store.
 */
export async function sweepLookups(store: PersistedLookupStore): Promise<void> {
  const { persistLookups } = await loadSettings();
  await (persistLookups ? store.sweep() : store.clear());
}

export function registerLookupSweep(
  store: PersistedLookupStore = new PersistedLookupStore(),
): void {
  const sweepNow = (): void => {
    void scheduleLookupSweep();
    void sweepLookups(store);
  };
  browser.runtime.onInstalled.addListener(sweepNow);
  browser.runtime.onStartup.addListener(sweepNow);
  browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === LOOKUP_SWEEP_ALARM) void sweepLookups(store);
  });
}
