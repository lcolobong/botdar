import { platformIds } from "@/src/core/policy/defaults";
import { Toggle } from "@/src/ui/controls/Toggle";
import { PLATFORM_DOMAINS, PLATFORM_NAMES } from "@/src/ui/platforms";
import type { SettingsSectionProps } from "./sectionProps";

export function PlatformsSection({ settings, update }: SettingsSectionProps) {
  return (
    <>
      <h2>Platforms</h2>
      {platformIds.map((platform) => (
        <div class="bd-row" key={platform}>
          <div class="bd-row__text">
            <p>{PLATFORM_NAMES[platform]}</p>
            <span class="bd-caption">{PLATFORM_DOMAINS[platform]}</span>
          </div>
          <Toggle
            checked={settings.platforms[platform]}
            label={PLATFORM_NAMES[platform]}
            onChange={(enabled) =>
              update({ platforms: { ...settings.platforms, [platform]: enabled } })
            }
          />
        </div>
      ))}
    </>
  );
}
