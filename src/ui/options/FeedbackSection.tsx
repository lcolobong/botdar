import { useState } from "preact/hooks";
import { clearFeedback, exportFeedbackJson } from "@/src/core/feedback";
import { downloadText } from "@/src/ui/download";

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
    </>
  );
}
