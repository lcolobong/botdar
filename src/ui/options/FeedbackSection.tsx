import { useState } from "preact/hooks";
import { clearFeedback, exportFeedbackJson } from "@/src/core/feedback";
import { downloadText } from "@/src/ui/download";
import { ConfirmButtons } from "./ConfirmButtons";
import { SettingsRow } from "./SettingsRow";

export const FEEDBACK_FILE_NAME = "botdar-feedback.json";

export function feedbackCountLine(count: number): string {
  return `${count} ${count === 1 ? "report" : "reports"} stored on this device`;
}

export interface FeedbackSectionProps {
  feedbackCount: number;
  /** Reloads the page's data, so the count drops to zero after a clear. */
  reload: () => void;
}

export function FeedbackSection({ feedbackCount, reload }: FeedbackSectionProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);

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

  return (
    <>
      <h2>Feedback</h2>
      <SettingsRow
        title={feedbackCountLine(feedbackCount)}
        caption={
          confirmingClear
            ? "This removes every report from this device."
            : "Export is a JSON file you can attach to a bug report."
        }
      >
        <div class="bd-row__actions">
          {confirmingClear ? (
            <ConfirmButtons
              confirmLabel="Confirm clear"
              onCancel={() => setConfirmingClear(false)}
              onConfirm={confirmClear}
            />
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
      </SettingsRow>
    </>
  );
}
