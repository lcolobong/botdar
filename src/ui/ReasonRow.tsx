import { reasonStrength, type ReasonStrength } from "@/src/core/scoring/strength";
import type { ReasonDirection, VerdictReason } from "@/src/core/types";
import { markerLabel } from "./cardCopy";

export type CardReason = Pick<
  VerdictReason,
  "text" | "why" | "direction" | "contribution" | "tier"
>;

/** The arrow's shape carries the direction on its own; its colour (card.css) only reinforces it. */
const LEAN_ARROWS: Readonly<Record<ReasonDirection, string>> = {
  automated: "↑",
  ordinary: "↓",
};

/**
 * One observation on the hover card: how strong a flag it is and which way it points, what was
 * seen, why it matters, and its source.
 */
export function ReasonRow({ reason }: { reason: CardReason }) {
  const strength: ReasonStrength | undefined = reasonStrength(reason.contribution);
  // The marker shows no word, so this is its only text for screen readers and on hover.
  const label: string = markerLabel(reason.direction, strength);
  const strengthClass: string = strength === undefined ? "" : ` bd-card__reason--${strength}`;
  return (
    <li class={`bd-card__reason bd-card__reason--${reason.direction}${strengthClass}`}>
      <span class="bd-card__lean" role="img" aria-label={label} title={label}>
        {strength === undefined ? null : (
          <span class="bd-card__strength">
            <span class="bd-card__strength-fill" />
          </span>
        )}
        <span class="bd-card__arrow">{LEAN_ARROWS[reason.direction]}</span>
      </span>
      <span class="bd-card__line">
        <span class="bd-card__fact">{reason.text}</span>
        {reason.why === "" ? null : <span class="bd-card__why"> · {reason.why}</span>}
      </span>
      <span class={`bd-dot bd-dot--${reason.tier}`} />
    </li>
  );
}
