import { fakeBrowser } from "wxt/testing/fake-browser";
import { buildDefaults } from "../../src/core/policy/defaults.ts";
import { applyPolicy } from "../../src/core/policy/merge.ts";
import type { EffectiveConfig, PlatformWeights } from "../../src/core/policy/merge.ts";
import {
  SETTINGS_STORAGE_KEY,
  applySettings,
  defaultSettings,
  loadSettings,
  onSettingsChanged,
  parseSettings,
  saveSettings,
} from "../../src/core/settings.ts";
import type { Settings } from "../../src/core/settings.ts";
import type { PlatformId } from "../../src/core/types.ts";

function weights(): Record<PlatformId, PlatformWeights> {
  const platform = (): PlatformWeights => ({
    prior: -2.5,
    thresholds: { some: 0.3, many: 0.6 },
    features: {},
  });
  return { x: platform(), reddit: platform(), bluesky: platform() };
}

function customSettings(): Settings {
  return {
    platforms: { x: false, reddit: true, bluesky: true },
    conservativeMode: true,
    labelStyle: "sus",
    showLikelyHuman: true,
    redditCommentLabels: "label",
    eagerLookups: true,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("defaultSettings", () => {
  it("has every platform on, conservative mode off, plain labels, glyph comments and no eager lookups", () => {
    expect(defaultSettings).toEqual({
      platforms: { x: true, reddit: true, bluesky: true },
      conservativeMode: false,
      labelStyle: "plain",
      showLikelyHuman: false,
      redditCommentLabels: "glyph",
      eagerLookups: false,
    });
    expect(Object.isFrozen(defaultSettings.platforms)).toBe(true);
  });
});

describe("parseSettings", () => {
  it.each([[undefined], [null], ["settings"], [3], [[]]])(
    "returns the defaults for %p",
    (stored) => {
      expect(parseSettings(stored)).toEqual(defaultSettings);
    },
  );

  it("keeps every valid field", () => {
    expect(parseSettings(customSettings())).toEqual(customSettings());
  });

  it("falls back per field when a value has the wrong type", () => {
    const parsed: Settings = parseSettings({
      platforms: { x: "no", reddit: false, mastodon: true },
      conservativeMode: 1,
      labelStyle: "emoji",
      showLikelyHuman: "yes",
      redditCommentLabels: 2,
      eagerLookups: true,
    });
    expect(parsed).toEqual({
      ...defaultSettings,
      platforms: { x: true, reddit: false, bluesky: true },
      eagerLookups: true,
    });
  });

  it("drops unknown keys", () => {
    const parsed: Settings = parseSettings({ ...customSettings(), extra: true });
    expect(Object.keys(parsed)).toEqual(Object.keys(defaultSettings));
  });
});

describe("storage", () => {
  it("loads the defaults when nothing is stored", async () => {
    expect(await loadSettings()).toEqual(defaultSettings);
  });

  it("round-trips through storage.local under settings.v1", async () => {
    await saveSettings(customSettings());
    const stored: Record<string, unknown> =
      await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY);
    expect(stored[SETTINGS_STORAGE_KEY]).toEqual(customSettings());
    expect(await loadSettings()).toEqual(customSettings());
  });

  it("repairs corrupted stored data on load", async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { labelStyle: "icon", platforms: 5 },
    });
    expect(await loadSettings()).toEqual({ ...defaultSettings, labelStyle: "icon" });
  });

  it("notifies subscribers with parsed settings until unsubscribed", async () => {
    const seen: Settings[] = [];
    const unsubscribe: () => void = onSettingsChanged((settings) => seen.push(settings));
    await saveSettings(customSettings());
    await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: { conservativeMode: "bad" } });
    await fakeBrowser.storage.local.set({ unrelated: 1 });
    unsubscribe();
    await saveSettings(defaultSettings);
    expect(seen).toEqual([customSettings(), defaultSettings]);
  });

  it("ignores changes in other storage areas", async () => {
    const seen: Settings[] = [];
    onSettingsChanged((settings) => seen.push(settings));
    await fakeBrowser.storage.sync.set({ [SETTINGS_STORAGE_KEY]: customSettings() });
    expect(seen).toEqual([]);
  });
});

describe("applySettings", () => {
  it("leaves the effective config unchanged under the defaults", () => {
    const effective: EffectiveConfig = applyPolicy(buildDefaults, weights(), null);
    const overlaid: EffectiveConfig = applySettings(effective, defaultSettings);
    expect(overlaid).toEqual(effective);
    expect(Object.isFrozen(overlaid)).toBe(true);
    expect(Object.isFrozen(overlaid.platforms.x)).toBe(true);
  });

  it("ANDs platform toggles into enabled", () => {
    const effective: EffectiveConfig = applyPolicy(buildDefaults, weights(), null);
    const overlaid: EffectiveConfig = applySettings(effective, {
      ...defaultSettings,
      platforms: { x: false, reddit: true, bluesky: false },
    });
    expect(overlaid.platforms.x.enabled).toBe(false);
    expect(overlaid.platforms.reddit.enabled).toBe(true);
    expect(overlaid.platforms.bluesky.enabled).toBe(false);
  });

  it("cannot enable a platform or tier the policy disabled", () => {
    const effective: EffectiveConfig = applyPolicy(buildDefaults, weights(), {
      schema: 1,
      version: 2,
      issuedAt: "2026-10-22T00:00:00Z",
      minExtensionVersion: "0.1.0",
      platforms: { x: { enabled: false, tiers: { t2: false } } },
    });
    const overlaid: EffectiveConfig = applySettings(effective, defaultSettings);
    expect(overlaid.platforms.x.enabled).toBe(false);
    expect(overlaid.platforms.x.tiers.t2).toBe(false);
  });

  it("forces Tier 2 off everywhere in conservative mode and leaves Tier 1 alone", () => {
    const effective: EffectiveConfig = applyPolicy(buildDefaults, weights(), null);
    const overlaid: EffectiveConfig = applySettings(effective, {
      ...defaultSettings,
      conservativeMode: true,
    });
    for (const platform of ["x", "reddit", "bluesky"] as const) {
      expect(overlaid.platforms[platform].tiers).toEqual({ t1: true, t2: false });
    }
    expect(overlaid.weights).toBe(effective.weights);
  });
});
