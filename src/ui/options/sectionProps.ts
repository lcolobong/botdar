import type { Settings } from "@/src/core/settings";

/** What a settings section reads and how it writes: the page reloads once a patch has landed. */
export interface SettingsSectionProps {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}
