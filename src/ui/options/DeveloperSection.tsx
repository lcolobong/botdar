import { Toggle } from "@/src/ui/controls/Toggle";
import type { SettingsSectionProps } from "./sectionProps";

export function DeveloperSection({ settings, update }: SettingsSectionProps) {
  return (
    <>
      <h2>Developer</h2>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Diagnostics in the popup</p>
          <span class="bd-caption">
            Shows what Botdar found on the current page and lets you save its markup for a bug
            report. Off is fine for everyday use.
          </span>
        </div>
        <Toggle
          checked={settings.developerMode}
          label="Diagnostics in the popup"
          onChange={(developerMode) => update({ developerMode })}
        />
      </div>
    </>
  );
}
