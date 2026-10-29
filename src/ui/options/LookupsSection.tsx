import { useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import { LOOKUP_KEY_PREFIX } from "@/src/core/persistedLookups";
import { Toggle } from "@/src/ui/controls/Toggle";
import type { SettingsSectionProps } from "./sectionProps";
import { ConfirmButtons } from "./ConfirmButtons";
import { SettingsRow } from "./SettingsRow";

/** How long "Cleared." stays up if no new lookup is stored first. */
const CLEARED_CAPTION_MS = 5000;

type LookupsClearState = "idle" | "confirming" | "cleared" | "failed";

const LOOKUPS_CLEAR_CAPTIONS: Record<LookupsClearState, string> = {
  idle: "Removes every remembered lookup and changes the key they were stored under.",
  confirming: "This removes every remembered lookup from this device.",
  cleared: "Cleared. The next hover fetches fresh data.",
  failed: "Could not clear the cached lookups. Try again.",
};

export interface LookupsSectionProps extends SettingsSectionProps {
  /** Clears the page's one PersistedLookupStore, which App also clears when remembering goes off. */
  clearLookupStore: () => Promise<void>;
}

export function LookupsSection({ settings, update, clearLookupStore }: LookupsSectionProps) {
  const [lookupsClear, setLookupsClear] = useState<LookupsClearState>("idle");

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

  const clearLookups = (): void => {
    clearLookupStore().then(
      () => setLookupsClear("cleared"),
      () => setLookupsClear("failed"),
    );
  };

  return (
    <>
      <h2>Lookups</h2>
      <SettingsRow
        title="Conservative mode"
        caption={'Use only what the page already shows. More badges will read "No read".'}
      >
        <Toggle
          checked={settings.conservativeMode}
          label="Conservative mode"
          onChange={(conservativeMode) => update({ conservativeMode })}
        />
      </SettingsRow>

      <SettingsRow
        title="Remember lookups for 7 days"
        caption={
          <>
            Keeps what a lookup found on this device so the same account is not fetched again. It
            stores no names or handles in readable form and never leaves this device.
          </>
        }
      >
        <Toggle
          checked={settings.persistLookups}
          label="Remember lookups for 7 days"
          onChange={(persistLookups) => update({ persistLookups })}
        />
      </SettingsRow>
      <SettingsRow title="Clear cached lookups" caption={LOOKUPS_CLEAR_CAPTIONS[lookupsClear]}>
        <div class="bd-row__actions">
          {lookupsClear === "confirming" ? (
            <ConfirmButtons
              confirmLabel="Confirm clear cache"
              onCancel={() => setLookupsClear("idle")}
              onConfirm={clearLookups}
            />
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
      </SettingsRow>
    </>
  );
}
