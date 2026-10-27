import { useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { loadSettings, onSettingsChanged } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import { Badge } from "../Badge";
import { Toggle } from "../controls/Toggle";
import type { BadgeTier } from "../labels";
import { patchSettings } from "../patchSettings";
import { PRIVACY_SENTENCE } from "../popup/App";
import { markOnboardingSeen } from "./seen";

export const PANEL_COUNT = 3;

interface TierNote {
  tier: BadgeTier;
  note: string;
}

const TIER_NOTES: readonly TierNote[] = [
  { tier: "many", note: "Several independent patterns common in automated accounts" },
  { tier: "some", note: "One or two things worth a look" },
  { tier: "declared", note: "The account carries the platform's own automated label" },
  {
    tier: "typical",
    note: "Nothing stands out. Turn it off in settings for a quieter feed",
  },
  { tier: "unknown", note: "Too little to go on yet; the card says why" },
];

const noop = (): void => undefined;

function IllustrativeBadge({ tier }: { tier: BadgeTier }) {
  return (
    <Badge
      tier={tier}
      labelStyle="plain"
      density="x"
      lowConfidence={false}
      paused={false}
      loading={false}
      glyphOnlyAtCommentDensity={false}
      onOpen={noop}
      onClose={noop}
    />
  );
}

function BadgePanel() {
  return (
    <>
      <h1 class="bd-display">A badge on every author</h1>
      <p>
        Every author gets a read. Hover the badge to see the two to four observations behind it and
        why they might be wrong.
      </p>
      <div class="bd-panel__body">
        {TIER_NOTES.map(({ tier, note }) => (
          <div class="bd-tier" key={tier}>
            <IllustrativeBadge tier={tier} />
            {note}
          </div>
        ))}
      </div>
    </>
  );
}

function PrivacyPanel() {
  return (
    <>
      <h1 class="bd-display">Everything stays on this device</h1>
      <p>Botdar reads what is already on the page and computes the badge in your browser.</p>
      <div class="bd-panel__body">
        <div class="bd-block">
          <strong>What it reads:</strong> the handle, join date, follower counts and bio that the
          page already shows or already loaded, and the public profile: on Reddit and Hacker News
          when a post comes into view, elsewhere when you hover a badge.
        </div>
        <div class="bd-block">
          <strong>What leaves your browser:</strong> nothing about the accounts you see. Once a day
          it downloads a small signed settings file from this project's site.
        </div>
        <div class="bd-block">
          <strong>What it never does:</strong> hide posts, send names anywhere, or call anyone a
          bot. It describes patterns and shows you why.
        </div>
        <p class="bd-caption">{PRIVACY_SENTENCE}</p>
      </div>
    </>
  );
}

function ControlsPanel({ settings }: { settings: Settings | null }) {
  return (
    <>
      <h1 class="bd-display">Turn it down any time</h1>
      <p>Two switches cover it. Both live in the popup and in settings.</p>
      <div class="bd-panel__body">
        <div class="bd-block bd-block--row">
          <div class="bd-row__text">
            <p>Conservative mode</p>
            <span class="bd-caption">
              Never ask a platform for a profile. Badges rely on the page alone.
            </span>
          </div>
          <Toggle
            checked={settings?.conservativeMode ?? false}
            label="Conservative mode"
            disabled={settings === null}
            onChange={(conservativeMode) => void patchSettings({ conservativeMode })}
          />
        </div>
        <div class="bd-block">
          <p>Per platform</p>
          <span class="bd-caption">
            Turn X, Reddit, Bluesky or Hacker News off from the toolbar popup any time.
          </span>
        </div>
        <p class="bd-caption">
          If a platform changes or pushes back, we can pause lookups for everyone through the signed
          settings file. You will see a notice in the popup when that happens.
        </p>
      </div>
    </>
  );
}

/** The tab closes itself; a page opened outside a tab (a preview) falls back to window.close. */
async function finish(): Promise<void> {
  await markOnboardingSeen();
  const tab = await browser.tabs.getCurrent();
  if (tab?.id !== undefined) {
    await browser.tabs.remove(tab.id);
  } else {
    window.close();
  }
}

export function App() {
  const [panel, setPanel] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, []);

  const last: boolean = panel === PANEL_COUNT - 1;
  const advance = (): void => {
    if (last) {
      void finish();
    } else {
      setPanel(panel + 1);
    }
  };

  return (
    <div class="bd-page bd-onboarding">
      <section class="bd-panel" aria-label={`Step ${panel + 1} of ${PANEL_COUNT}`}>
        {panel === 0 && <BadgePanel />}
        {panel === 1 && <PrivacyPanel />}
        {panel === 2 && <ControlsPanel settings={settings} />}
        <div class="bd-panel__foot">
          <div class="bd-dots" aria-hidden="true">
            {Array.from({ length: PANEL_COUNT }, (_, index) => (
              <i key={index} class={index === panel ? "bd-dots__on" : ""} />
            ))}
          </div>
          <button type="button" class="bd-btn bd-btn--primary" onClick={advance}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </section>
    </div>
  );
}
