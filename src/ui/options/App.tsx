/**
 * The options page: it loads the settings, the stored feedback count and the policy status, and
 * lays out one component per section (beside it in src/ui/options/). Settings writes go through
 * update, which also wipes remembered lookups when remembering is turned off.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { listFeedback } from "@/src/core/feedback";
import { PersistedLookupStore } from "@/src/core/persistedLookups";
import { defaultSettings, loadSettings, onSettingsChanged } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import { Mark } from "../Mark";
import { patchSettings } from "../patchSettings";
import { loadPolicyStatus } from "../policyStatus";
import type { PolicyStatus } from "../policyStatus";
import { PRIVACY_SENTENCE } from "../popup/App";
import { BadgesSection } from "./BadgesSection";
import { DeveloperSection } from "./DeveloperSection";
import { FeedbackSection } from "./FeedbackSection";
import { LookupsSection } from "./LookupsSection";
import { PlatformsSection } from "./PlatformsSection";
import { PolicySection } from "./PolicySection";

export { FEEDBACK_FILE_NAME, feedbackCountLine } from "./FeedbackSection";

export const PRIVACY_URL = "https://lcolobong.github.io/botdar/privacy.html";

const lookupStore: PersistedLookupStore = new PersistedLookupStore();

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

export function App({ now = Date.now }: AppProps) {
  const [data, setData] = useState<OptionsData | null>(null);
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
    // The wipe waits for the setting to land: a lookup still deciding whether to write then sees it off.
    const wipeAfter: boolean = patch.persistLookups === false;
    void patchSettings(patch)
      .then(() => (wipeAfter ? lookupStore.clear() : undefined))
      .then(reload);
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

      <LookupsSection
        settings={settings}
        update={update}
        clearLookupStore={() => lookupStore.clear()}
      />

      <BadgesSection settings={settings} update={update} />

      <DeveloperSection settings={settings} update={update} />

      <FeedbackSection feedbackCount={feedbackCount} reload={reload} />

      <PolicySection status={status} now={now} reload={reload} />

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
