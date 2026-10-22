import { loadSettings, saveSettings } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";

/**
 * Read-modify-write against storage rather than against the rendered settings, so two controls
 * changed before the page re-rendered cannot overwrite each other.
 */
export async function patchSettings(patch: Partial<Settings>): Promise<void> {
  const current: Settings = await loadSettings();
  await saveSettings({ ...current, ...patch });
}
