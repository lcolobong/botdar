import type { TargetedKeyboardEvent } from "preact";

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
}

export interface SegmentedProps<Value extends string> {
  /** The accessible name of the group. */
  label: string;
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}

const STEP_BY_KEY: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/** Pressed-button segments; the arrow keys move the selection and the focus along the group. */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<Value>) {
  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    const step: number | undefined = STEP_BY_KEY[event.key];
    if (step === undefined || options.length === 0) return;
    const current: number = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    const next: number = (current + step + options.length) % options.length;
    const option: SegmentedOption<Value> | undefined = options[next];
    if (option === undefined) return;
    event.preventDefault();
    onChange(option.value);
    const button: Element | undefined = event.currentTarget.children[next];
    if (button instanceof HTMLElement) button.focus();
  };
  return (
    <div role="group" class="bd-segmented" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
