export interface ConfirmButtonsProps {
  /** Names what the danger button removes, such as "Confirm clear cache". */
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The second step of a destructive clear: Cancel, then the danger button that confirms it. */
export function ConfirmButtons({ confirmLabel, onCancel, onConfirm }: ConfirmButtonsProps) {
  return (
    <>
      <button type="button" class="bd-btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" class="bd-btn bd-btn--danger" onClick={onConfirm}>
        {confirmLabel}
      </button>
    </>
  );
}
