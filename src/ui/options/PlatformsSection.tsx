import { platformIds } from "@/src/core/policy/defaults";
import { Toggle } from "@/src/ui/controls/Toggle";
import { PLATFORM_DOMAINS, PLATFORM_NAMES } from "@/src/ui/platforms";
import type { SettingsSectionProps } from "./sectionProps";
import { SettingsRow } from "./SettingsRow";

export function PlatformsSection({ settings, update }: SettingsSectionProps) {
  return (
    <>
      <h2>Platforms</h2>
      {platformIds.map((platform) => (
        <SettingsRow
          key={platform}
          title={PLATFORM_NAMES[platform]}
          caption={PLATFORM_DOMAINS[platform]}
        >
          <Toggle
            checked={settings.platforms[platform]}
            label={PLATFORM_NAMES[platform]}
            onChange={(enabled) =>
              update({ platforms: { ...settings.platforms, [platform]: enabled } })
            }
          />
        </SettingsRow>
      ))}
    </>
  );
}
