import { useCallback, useEffect, useState } from "preact/hooks";
import { clearFeedback, exportFeedbackJson, listFeedback } from "@/src/core/feedback";
import { sendRequest } from "@/src/core/messaging";
import { platformIds } from "@/src/core/policy/defaults";
import { defaultSettings, loadSettings, onSettingsChanged } from "@/src/core/settings";
import type { LabelStyle, RedditCommentLabels, Settings } from "@/src/core/settings";
import { Segmented } from "../controls/Segmented";
import type { SegmentedOption } from "../controls/Segmented";
import { Toggle } from "../controls/Toggle";
import { Mark } from "../Mark";
import { patchSettings } from "../patchSettings";
import { PLATFORM_DOMAINS, PLATFORM_NAMES } from "../platforms";
import { loadPolicyStatus, policyFetchedLine, policyVersionLine } from "../policyStatus";
import type { PolicyStatus } from "../policyStatus";
import { PRIVACY_SENTENCE } from "../popup/App";

export const FEEDBACK_FILE_NAME = "botdar-feedback.json";
export const PRIVACY_URL = "https://lcolobong.github.io/botdar/privacy.html";

const LABEL_STYLES: readonly SegmentedOption<LabelStyle>[] = [
  { value: "plain", label: "Plain" },
  { value: "sus", label: "Sus scale" },
  { value: "icon", label: "Icon only" },
];

const REDDIT_COMMENT_LABELS: readonly SegmentedOption<RedditCommentLabels>[] = [
  { value: "glyph", label: "Glyph only" },
  { value: "label", label: "Glyph and label" },
];

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

function downloadText(fileName: string, contents: string): void {
  const url: string = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function feedbackCountLine(count: number): string {
  return `${count} ${count === 1 ? "report" : "reports"} stored on this device`;
}

export function App({ now = Date.now }: AppProps) {
  const [data, setData] = useState<OptionsData | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [checking, setChecking] = useState(false);
  const reload = useCallback((): void => {
    void loadOptionsData().then(setData);
  }, []);

  useEffect(() => {
    reload();
    return onSettingsChanged(reload);
  }, [reload]);

  if (data === null) return <div class="bd-page bd-column" />;
  const { settings, feedbackCount, status } = data;

  const update = (patch: Partial<Settings>): void => {
    void patchSettings(patch).then(reload);
  };
  const exportFeedback = (): void => {
    void exportFeedbackJson().then((json) => downloadText(FEEDBACK_FILE_NAME, json));
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

      <h2>Lookups</h2>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Conservative mode</p>
          <span class="bd-caption">
            Use only what the page already shows. Badges will say "not enough data" more often.
          </span>
        </div>
        <Toggle
          checked={settings.conservativeMode}
          label="Conservative mode"
          onChange={(conservativeMode) => update({ conservativeMode })}
        />
      </div>

      <h2>Badges</h2>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Label style</p>
          <span class="bd-caption">
            Plain is the default. Sus scale swaps the words for internet lingo. Icon only drops the
            words.
          </span>
        </div>
        <Segmented
          label="Label style"
          options={LABEL_STYLES}
          value={settings.labelStyle}
          onChange={(labelStyle) => update({ labelStyle })}
        />
      </div>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Show Likely human</p>
          <span class="bd-caption">
            Adds a green badge on accounts that look fine. Off keeps the feed quiet.
          </span>
        </div>
        <Toggle
          checked={settings.showLikelyHuman}
          label="Show Likely human"
          onChange={(showLikelyHuman) => update({ showLikelyHuman })}
        />
      </div>
      <div class="bd-row">
        <div class="bd-row__text">
          <p>Labels in Reddit comments</p>
          <span class="bd-caption">Glyph only keeps comment rows tidy.</span>
        </div>
        <Segmented
          label="Labels in Reddit comments"
          options={REDDIT_COMMENT_LABELS}
          value={settings.redditCommentLabels}
          onChange={(redditCommentLabels) => update({ redditCommentLabels })}
        />
      </div>

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
