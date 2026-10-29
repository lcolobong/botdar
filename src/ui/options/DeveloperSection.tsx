import { Toggle } from "@/src/ui/controls/Toggle";
import type { SettingsSectionProps } from "./sectionProps";
import { SettingsRow } from "./SettingsRow";

export function DeveloperSection({ settings, update }: SettingsSectionProps) {
  return (
    <>
      <h2>Developer</h2>
      <SettingsRow
        title="Diagnostics in the popup"
        caption={
          <>
            Shows what Botdar found on the current page and lets you save its markup for a bug
            report. Off is fine for everyday use.
          </>
        }
      >
        <Toggle
          checked={settings.developerMode}
          label="Diagnostics in the popup"
          onChange={(developerMode) => update({ developerMode })}
        />
      </SettingsRow>
    </>
  );
}
