/**
 * User settings: the last layer over build defaults and policy. Like the policy they can only narrow
 * the effective config (ADR-0007); the display settings only change how verdicts are rendered.
 * Stored under `settings.v1` in storage.local; nothing here references an account (ADR-0012).
 */
import { browser } from "wxt/browser";
import { isPlatformId, platformIds } from "./policy/defaults.ts";
import { deepFreeze } from "./policy/freeze.ts";
import type { EffectivePlatformConfig, PlatformId } from "./types.ts";

export type LabelStyle = "plain" | "sus" | "icon";
export type RedditCommentLabels = "glyph" | "label";

export interface Settings {
  platforms: Record<PlatformId, boolean>;
  /** Drops Tier 2 (active lookups) everywhere. */
  conservativeMode: boolean;
  labelStyle: LabelStyle;
  showLikelyHuman: boolean;
  redditCommentLabels: RedditCommentLabels;
  /** Shows the popup's diagnostics section: per-page counts and the page snapshot export. */
  developerMode: boolean;
}

export const SETTINGS_STORAGE_KEY = "settings.v1";

const LABEL_STYLES: readonly LabelStyle[] = ["plain", "sus", "icon"];
const REDDIT_COMMENT_LABELS: readonly RedditCommentLabels[] = ["glyph", "label"];

export const defaultSettings: Settings = deepFreeze({
  platforms: { x: true, reddit: true, bluesky: true },
  conservativeMode: false,
  labelStyle: "plain",
  showLikelyHuman: false,
  redditCommentLabels: "glyph",
  developerMode: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function choiceOr<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === "string" && (choices as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function platformTogglesOr(value: unknown): Record<PlatformId, boolean> {
  const toggles: Record<PlatformId, boolean> = { ...defaultSettings.platforms };
  if (!isRecord(value)) return toggles;
  for (const [platform, enabled] of Object.entries(value)) {
    if (isPlatformId(platform)) toggles[platform] = booleanOr(enabled, toggles[platform]);
  }
  return toggles;
}

/** Stored data is untrusted: every field that is missing or has the wrong type falls back to its default. */
export function parseSettings(stored: unknown): Settings {
  const record: Record<string, unknown> = isRecord(stored) ? stored : {};
  return deepFreeze({
    platforms: platformTogglesOr(record.platforms),
    conservativeMode: booleanOr(record.conservativeMode, defaultSettings.conservativeMode),
    labelStyle: choiceOr(record.labelStyle, LABEL_STYLES, defaultSettings.labelStyle),
    showLikelyHuman: booleanOr(record.showLikelyHuman, defaultSettings.showLikelyHuman),
    redditCommentLabels: choiceOr(
      record.redditCommentLabels,
      REDDIT_COMMENT_LABELS,
      defaultSettings.redditCommentLabels,
    ),
    developerMode: booleanOr(record.developerMode, defaultSettings.developerMode),
  });
}

export async function loadSettings(): Promise<Settings> {
  const stored: Record<string, unknown> = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  return parseSettings(stored[SETTINGS_STORAGE_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: parseSettings(settings) });
}

/** Calls the listener with the parsed settings after every change; returns an unsubscribe function. */
export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string): void => {
    const change: { newValue?: unknown } | undefined = changes[SETTINGS_STORAGE_KEY];
    if (areaName !== "local" || change === undefined) return;
    listener(parseSettings(change.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

/** Overlays the settings on an effective config: platform toggles AND into enabled, conservative mode drops Tier 2. */
export function applySettings<C extends { platforms: Record<PlatformId, EffectivePlatformConfig> }>(
  effective: C,
  settings: Settings,
): C {
  const platforms: Partial<Record<PlatformId, EffectivePlatformConfig>> = {};
  for (const platform of platformIds) {
    const config: EffectivePlatformConfig = effective.platforms[platform];
    platforms[platform] = Object.freeze({
      ...config,
      enabled: config.enabled && settings.platforms[platform],
      tiers: Object.freeze({
        t1: config.tiers.t1,
        t2: config.tiers.t2 && !settings.conservativeMode,
      }),
    });
  }
  // Only the objects created here are frozen; nested input such as the weights is shared, not owned.
  return Object.freeze({
    ...effective,
    platforms: Object.freeze(platforms) as Record<PlatformId, EffectivePlatformConfig>,
  });
}
