import type { SourceTier } from "@/src/core/types";
import { FeedbackButton } from "./FeedbackButton";
import { Glyph } from "./Glyph";
import { accessibleLabel, glyphFor, visibleLabel, type BadgeTier, type LabelStyle } from "./labels";

export interface CardReason {
  text: string;
  tier: SourceTier;
}

export interface HoverCardProps {
  id: string;
  tier: BadgeTier;
  labelStyle: LabelStyle;
  /** Display form with the platform prefix, e.g. "@handle" or "u/handle". */
  handle: string;
  reasons: CardReason[];
  confidenceNote?: string;
  caveat?: string;
  loading: boolean;
  lowConfidence: boolean;
  /** Shown once per session so the source dots explain themselves. */
  showLegend: boolean;
  feedbackSent: boolean;
  onFeedback: () => void;
  onSettings: () => void;
}

const SOURCE_LEGEND: Record<SourceTier, string> = {
  0: "on the page",
  1: "page data",
  2: "profile lookup",
};

export function HoverCard(props: HoverCardProps) {
  const title: string = props.loading
    ? "Checking"
    : (visibleLabel(props.tier, props.labelStyle) ?? accessibleLabel(props.tier));
  return (
    <section
      id={props.id}
      class="bd-card"
      role="dialog"
      aria-label={`${accessibleLabel(props.tier)}: ${props.handle}`}
      aria-busy={props.loading}
    >
      <div class="bd-card__head">
        <div>
          <h2 class="bd-card__title">{title}</h2>
          <p class="bd-card__handle">{props.handle}</p>
        </div>
        <span
          class={`bd-badge bd-badge--${badgeClass(props.tier)} ${props.lowConfidence ? "bd-badge--hollow" : ""} ${props.loading ? "bd-badge--loading" : ""}`}
        >
          <Glyph name={glyphFor(props.tier)} />
          {visibleLabel(props.tier, props.labelStyle)}
        </span>
      </div>
      <ul class="bd-card__reasons">
        {props.reasons.map((reason: CardReason) => (
          <li class="bd-card__reason" key={reason.text}>
            <span class={`bd-dot bd-dot--${reason.tier}`} />
            {reason.text}
          </li>
        ))}
      </ul>
      {props.showLegend ? (
        <p class="bd-card__legend">
          {([0, 1, 2] as const).map((tier: SourceTier) => (
            <span key={tier}>
              <i class={`bd-dot bd-dot--${tier}`} />
              {SOURCE_LEGEND[tier]}
            </span>
          ))}
        </p>
      ) : null}
      {props.confidenceNote ? <p class="bd-card__note">{props.confidenceNote}</p> : null}
      {props.caveat ? <p class="bd-card__caveat">{props.caveat}</p> : null}
      <div class="bd-card__foot">
        <FeedbackButton
          sent={props.feedbackSent}
          disabled={props.loading}
          onToggle={props.onFeedback}
        />
        <button type="button" class="bd-btn bd-btn--link" onClick={props.onSettings}>
          Settings
        </button>
      </div>
    </section>
  );
}

function badgeClass(tier: BadgeTier): string {
  return tier === "typical" ? "human" : tier;
}
