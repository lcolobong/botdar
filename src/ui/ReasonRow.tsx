import type { ReasonDirection, VerdictReason } from "@/src/core/types";

export type CardReason = Pick<VerdictReason, "text" | "why" | "direction" | "tier">;

interface LeanMarker {
  arrow: string;
  /** The marker shows no word, so this is its only text for screen readers and on hover. */
  label: string;
}

/** The arrow's shape carries the direction on its own; its colour (card.css) only reinforces it. */
const LEAN_MARKERS: Readonly<Record<ReasonDirection, LeanMarker>> = {
  automated: { arrow: "↑", label: "Points towards automated" },
  ordinary: { arrow: "↓", label: "Points towards ordinary" },
};

/** One observation on the hover card: which way it points, what was seen, why it matters, and its source. */
export function ReasonRow({ reason }: { reason: CardReason }) {
  const marker: LeanMarker = LEAN_MARKERS[reason.direction];
  return (
    <li class={`bd-card__reason bd-card__reason--${reason.direction}`}>
      <span class="bd-card__lean" role="img" aria-label={marker.label} title={marker.label}>
        {marker.arrow}
      </span>
      <span class="bd-card__line">
        <span class="bd-card__fact">{reason.text}</span>
        {reason.why === "" ? null : <span class="bd-card__why"> · {reason.why}</span>}
      </span>
      <span class={`bd-dot bd-dot--${reason.tier}`} />
    </li>
  );
}
