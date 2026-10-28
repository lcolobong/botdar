import { useCallback, useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { clearFeedback, exportFeedbackJson, listFeedback } from "@/src/core/feedback";
import { sendRequest } from "@/src/core/messaging";
import { LOOKUP_KEY_PREFIX, PersistedLookupStore } from "@/src/core/persistedLookups";
import { defaultSettings, loadSettings, onSettingsChanged } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import { Toggle } from "../controls/Toggle";
import { downloadText } from "../download";
import { Mark } from "../Mark";
import { patchSettings } from "../patchSettings";
import { loadPolicyStatus, policyFetchedLine, policyVersionLine } from "../policyStatus";
import type { PolicyStatus } from "../policyStatus";
import { PRIVACY_SENTENCE } from "../popup/App";
import { BadgesSection } from "./BadgesSection";
import { DeveloperSection } from "./DeveloperSection";
import { PlatformsSection } from "./PlatformsSection";

export const FEEDBACK_FILE_NAME = "botdar-feedback.json";
export const PRIVACY_URL = "https://lcolobong.github.io/botdar/privacy.html";

const lookupStore: PersistedLookupStore = new PersistedLookupStore();
/** How long "Cleared." stays up if no new lookup is stored first. */
const CLEARED_CAPTION_MS = 5000;

type LookupsClearState = "idle" | "confirming" | "cleared" | "failed";

const LOOKUPS_CLEAR_CAPTIONS: Record<LookupsClearState, string> = {
  idle: "Removes every remembered lookup and changes the key they were stored under.",
  confirming: "This removes every remembered lookup from this device.",
  cleared: "Cleared. The next hover fetches fresh data.",
  failed: "Could not clear the cached lookups. Try again.",
};

export interface AppProps {
  now?: () => number;
}

interface OptionsData {
  settings: Settings;
  feedbackCount: number;
  status: PolicyStatus;
}

async function loadOptionsData(): Promise<OptionsData> {
  const [settings, entries, status] = await Promise.all([
    loadSettings(),
    listFeedback(),
    loadPolicyStatus(),
  ]);
  return { settings, feedbackCount: entries.length, status };
}

export function feedbackCountLine(count: number): string {
  return `${count} ${count === 1 ? "report" : "reports"} stored on this device`;
}

export function App({ now = Date.now }: AppProps) {
  const [data, setData] = useState<OptionsData | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lookupsClear, setLookupsClear] = useState<LookupsClearState>("idle");
  const reload = useCallback((): void => {
    void loadOptionsData().then(setData);
  }, []);

  useEffect(() => {
    reload();
    return onSettingsChanged(reload);
  }, [reload]);

  useEffect(() => {
    if (lookupsClear !== "cleared") return undefined;
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => setLookupsClear("idle"),
      CLEARED_CAPTION_MS,
    );
    // A lookup stored after the clear makes "Cleared." untrue, so the caption goes at once.
    const onChanged = (changes: Record<string, unknown>, areaName: string): void => {
      if (
        areaName === "local" &&
        Object.keys(changes).some((key) => key.startsWith(LOOKUP_KEY_PREFIX))
      ) {
        setLookupsClear("idle");
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      clearTimeout(timer);
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [lookupsClear]);

  if (data === null) return <div class="bd-page bd-column" />;
  const { settings, feedbackCount, status } = data;

  const update = (patch: Partial<Settings>): void => {
    // The wipe waits for the setting to land: a lookup still deciding whether to write then sees it off.
    const wipeAfter: boolean = patch.persistLookups === false;
    void patchSettings(patch)
      .then(() => (wipeAfter ? lookupStore.clear() : undefined))
      .then(reload);
  };
  const clearLookups = (): void => {
    lookupStore.clear().then(
      () => setLookupsClear("cleared"),
      () => setLookupsClear("failed"),
    );
  };
  const exportFeedback = (): void => {
    void exportFeedbackJson().then((json) =>
      downloadText(FEEDBACK_FILE_NAME, json, "application/json"),
    );
  };
  const confirmClear = (): void => {
    void clearFeedback().then(() => {
      setConfirmingClear(false);
      reload();
    });
  };
  const checkPolicyNow = (): void => {
    setChecking(true);
    // The background answers after its fetch; a missing handler only means no refresh happened.
    void sendRequest({ type: "policy.refresh" })
      .catch(() => undefined)
      .then(() => {
        setChecking(false);
        reload();
      });
  };

  return (
    <div class="bd-page bd-column">
      <div class="bd-head">
        <span class="bd-mark">
          <Mark />
          <h1>Botdar settings</h1>
        </span>
      </div>

      <PlatformsSection settings={settings} update={update} />

      <h2>Lookups</h2>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Conservative mode</p>
          <span class="bd-caption">
            Use only what the page already shows. More badges will read "No read".
          </span>
        </div>
        <Toggle
          checked={settings.conservativeMode}
          label="Conservative mode"
          onChange={(conservativeMode) => update({ conservativeMode })}
        />
      </div>

      <div class="bd-row">
        <div class="bd-row__text">
          <p>Remember lookups for 7 days</p>
          <span class="bd-caption">
            Keeps what a lookup found on this device so the same account is not fetched again. It
            stores no names or handles in readable form and never leaves this device.
          </span>
        </div>
        <Toggle
          checked={settings.persistLookups}
          label="Remember lookups for 7 days"
          onChange={(persistLookups) => update({ persistLookups })}
        />
      </div>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Clear cached lookups</p>
          <span class="bd-caption">{LOOKUPS_CLEAR_CAPTIONS[lookupsClear]}</span>
        </div>
        <div class="bd-row__actions">
          {lookupsClear === "confirming" ? (
            <>
              <button type="button" class="bd-btn" onClick={() => setLookupsClear("idle")}>
                Cancel
              </button>
              <button type="button" class="bd-btn bd-btn--danger" onClick={clearLookups}>
                Confirm clear cache
              </button>
            </>
          ) : (
            <button
              type="button"
              class="bd-btn bd-btn--danger"
              onClick={() => setLookupsClear("confirming")}
            >
              Clear cache
            </button>
          )}
        </div>
      </div>

      <BadgesSection settings={settings} update={update} />

      <DeveloperSection settings={settings} update={update} />

      <h2>Feedback</h2>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>{feedbackCountLine(feedbackCount)}</p>
          <span class="bd-caption">
            {confirmingClear
              ? "This removes every report from this device."
              : "Export is a JSON file you can attach to a bug report."}
          </span>
        </div>
        <div class="bd-row__actions">
          {confirmingClear ? (
            <>
              <button type="button" class="bd-btn" onClick={() => setConfirmingClear(false)}>
                Cancel
              </button>
              <button type="button" class="bd-btn bd-btn--danger" onClick={confirmClear}>
                Confirm clear
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                class="bd-btn"
                disabled={feedbackCount === 0}
                onClick={exportFeedback}
              >
                Export
              </button>
              <button
                type="button"
                class="bd-btn bd-btn--danger"
                disabled={feedbackCount === 0}
                onClick={() => setConfirmingClear(true)}
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      <h2>Policy</h2>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>{policyVersionLine(status)}</p>
          <span class="bd-caption">{policyFetchedLine(status, now())}</span>
        </div>
        <button type="button" class="bd-btn" disabled={checking} onClick={checkPolicyNow}>
          Check now
        </button>
      </div>

      <div class="bd-row">
        <span class="bd-caption">
          {PRIVACY_SENTENCE}{" "}
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
            Privacy
          </a>
        </span>
        <button
          type="button"
          class="bd-btn bd-btn--link"
          onClick={() => update({ ...defaultSettings })}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
