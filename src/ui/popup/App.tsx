import { useCallback, useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { platformIds } from "@/src/core/policy/defaults";
import { getEffectiveConfig } from "@/src/core/policy/loader";
import type { EffectiveConfig } from "@/src/core/policy/merge";
import type { PolicyNotice } from "@/src/core/policy/schema";
import { defaultWeights } from "@/src/core/scoring/weights";
import { loadSettings, onSettingsChanged } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import type { EffectivePlatformConfig, PlatformId } from "@/src/core/types";
import { Toggle } from "../controls/Toggle";
import { Mark } from "../Mark";
import { patchSettings } from "../patchSettings";
import { PLATFORM_NAMES } from "../platforms";
import { loadPolicyStatus, policyStatusLine } from "../policyStatus";
import type { PolicyStatus } from "../policyStatus";

export const NOTICE_SEEN_IDS_KEY = "notice.seenIds";
export const PRIVACY_SENTENCE = "Nothing about the accounts you see leaves this browser.";

export interface AppProps {
  now?: () => number;
}

interface PopupData {
  settings: Settings;
  effective: EffectiveConfig;
  status: PolicyStatus;
  seenNoticeIds: string[];
}

async function loadSeenNoticeIds(): Promise<string[]> {
  const stored: Record<string, unknown> = await browser.storage.local.get(NOTICE_SEEN_IDS_KEY);
  const ids: unknown = stored[NOTICE_SEEN_IDS_KEY];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

async function loadPopupData(): Promise<PopupData> {
  const [settings, effective, status, seenNoticeIds]: [
    Settings,
    EffectiveConfig,
    PolicyStatus,
    string[],
  ] = await Promise.all([
    loadSettings(),
    getEffectiveConfig(defaultWeights),
    loadPolicyStatus(),
    loadSeenNoticeIds(),
  ]);
  return { settings, effective, status, seenNoticeIds };
}

/** "paused" is the policy's doing, "off" the user's: the caption says which switch to look for. */
export function platformCaption(config: EffectivePlatformConfig, settings: Settings): string {
  if (!settings.platforms[config.platform]) return "Badges off";
  if (!config.enabled) return "Badges paused";
  const lookups: string = config.tiers.t2 ? "on" : settings.conservativeMode ? "off" : "paused";
  return `Badges on · lookups ${lookups}`;
}

export function App({ now = Date.now }: AppProps) {
  const [data, setData] = useState<PopupData | null>(null);
  const reload = useCallback((): void => {
    void loadPopupData().then(setData);
  }, []);

  useEffect(() => {
    reload();
    return onSettingsChanged(reload);
  }, [reload]);

  if (data === null) return <div class="bd-page bd-popup" />;
  const { settings, effective, status, seenNoticeIds } = data;
  const notice: PolicyNotice | undefined = effective.notice;
  const noticeVisible: boolean = notice !== undefined && !seenNoticeIds.includes(notice.id);

  const update = (patch: Partial<Settings>): void => {
    void patchSettings(patch).then(reload);
  };
  const setPlatform = (platform: PlatformId, enabled: boolean): void => {
    update({ platforms: { ...settings.platforms, [platform]: enabled } });
  };
  const dismissNotice = (): void => {
    if (notice === undefined) return;
    const ids: string[] = [...seenNoticeIds, notice.id];
    void browser.storage.local.set({ [NOTICE_SEEN_IDS_KEY]: ids }).then(reload);
  };
  const openSettings = (): void => {
    void browser.runtime.openOptionsPage().then(() => window.close());
  };

  return (
    <div class="bd-page bd-popup">
      <div class="bd-head">
        <span class="bd-mark">
          <Mark />
          <h1>Botdar</h1>
        </span>
        <span class="bd-caption">{policyStatusLine(status, now())}</span>
      </div>
      {noticeVisible && notice !== undefined && (
        <div class="bd-notice" role="status">
          <span>
            {notice.text}
            {notice.url !== undefined && (
              <>
                {" "}
                <a href={notice.url} target="_blank" rel="noreferrer">
                  Details
                </a>
              </>
            )}
          </span>
          <button type="button" class="bd-btn bd-btn--link" onClick={dismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      {platformIds.map((platform) => (
        <div class="bd-row" key={platform}>
          <div class="bd-row__text">
            <p>{PLATFORM_NAMES[platform]}</p>
            <span class="bd-caption">
              {platformCaption(effective.platforms[platform], settings)}
            </span>
          </div>
          <Toggle
            checked={settings.platforms[platform]}
            label={PLATFORM_NAMES[platform]}
            onChange={(enabled) => setPlatform(platform, enabled)}
          />
        </div>
      ))}
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Conservative mode</p>
          <span class="bd-caption">Never ask a platform for a profile</span>
        </div>
        <Toggle
          checked={settings.conservativeMode}
          label="Conservative mode"
          onChange={(conservativeMode) => update({ conservativeMode })}
        />
      </div>
      <div class="bd-row bd-popup__foot">
        <span class="bd-caption">{PRIVACY_SENTENCE}</span>
        <button type="button" class="bd-btn bd-btn--link" onClick={openSettings}>
          Settings
        </button>
      </div>
    </div>
  );
}
