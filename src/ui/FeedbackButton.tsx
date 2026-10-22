export interface FeedbackButtonProps {
  sent: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

/** "This looks wrong": one click records feedback locally and flips to a quiet sent state; a second click undoes it. */
export function FeedbackButton(props: FeedbackButtonProps) {
  if (props.sent) {
    return (
      <button
        type="button"
        class="bd-btn bd-btn--sent"
        aria-pressed="true"
        onClick={props.onToggle}
      >
        Noted, thanks · Undo
      </button>
    );
  }
  return (
    <button
      type="button"
      class="bd-btn"
      aria-pressed="false"
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      This looks wrong
    </button>
  );
}
