import type { ComponentChildren } from "preact";

export interface SettingsRowProps {
  title: ComponentChildren;
  caption: ComponentChildren;
  /** The row's control: a toggle, a segmented control, a button or a `bd-row__actions` group. */
  children: ComponentChildren;
}

/** One options-page row: a title over its caption, and the control that sets it beside them. */
export function SettingsRow({ title, caption, children }: SettingsRowProps) {
  return (
    <div class="bd-row">
      <div class="bd-row__text">
        <p>{title}</p>
        <span class="bd-caption">{caption}</span>
      </div>
      {children}
    </div>
  );
}
