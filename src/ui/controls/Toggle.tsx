export interface ToggleProps {
  checked: boolean;
  /** The accessible name; the visible label sits in the row beside the switch. */
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** A switch button: Enter and Space toggle it natively, the ring comes from .bd-toggle:focus-visible. */
export function Toggle({ checked, label, onChange, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      class="bd-toggle"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}
