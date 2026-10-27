import { useEffect, useState } from "preact/hooks";
import type { SourceTier } from "@/src/core/types";
import { whyToggleLabel } from "./cardCopy";
import { FeedbackButton } from "./FeedbackButton";
import { Glyph } from "./Glyph";
import { accessibleLabel, glyphFor, visibleLabel, type BadgeTier, type LabelStyle } from "./labels";
import { ReasonRow, type CardReason } from "./ReasonRow";

export interface HoverCardProps {
  id: string;
  /**
   * Which opening of the card this is (the hover controller's count). The card host is mounted
   * once and only hidden between openings, so the body is keyed on it and its open why clauses
   * reset each time the card opens (ADR-0023).
   */
  opening: number;
  tier: BadgeTier;
  labelStyle: LabelStyle;
  /** Display form with the platform prefix, e.g. "@handle" or "u/handle". */
  handle: string;
  reasons: CardReason[];
  /** Why there is no read; a No read card shows it in place of reasons, note, caveat and feedback. */
  explanation?: string;
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
  const noRead: boolean = props.tier === "unknown";
  const title: string = props.loading
    ? "Checking"
    : (visibleLabel(props.tier, props.labelStyle) ?? accessibleLabel(props.tier));
  return (
    <section
      id={props.id}
      class={`bd-card bd-card--${badgeClass(props.tier)}`}
      role="dialog"
      aria-label={`${accessibleLabel(props.tier, props.loading)}: ${props.handle}`}
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
          {visibleLabel(props.tier, props.labelStyle, props.loading)}
        </span>
      </div>
      {noRead ? (
        <NoReadBody explanation={props.explanation} />
      ) : (
        <ReadBody key={props.opening} {...props} />
      )}
      <div class="bd-card__foot">
        {noRead ? (
          <span />
        ) : (
          <FeedbackButton
            sent={props.feedbackSent}
            disabled={props.loading}
            onToggle={props.onFeedback}
          />
        )}
        <button type="button" class="bd-btn bd-btn--link" onClick={props.onSettings}>
          Settings
        </button>
      </div>
    </section>
  );
}

// MARK: - Bodies

/** Nothing was read, so there is no observation to dispute and no caveat to attach. */
function NoReadBody({ explanation }: { explanation: string | undefined }) {
  return explanation === undefined ? null : <p class="bd-card__explain">{explanation}</p>;
}

/**
 * A declared card's closing line explains the label rather than arguing against it, so it is not
 * headed as a reason the read could be wrong.
 */
function caveatLabel(tier: BadgeTier): string {
  return tier === "declared" ? "What this means" : "Why this could be wrong";
}

/**
 * A row the why toggle (ADR-0023) explains: weighed evidence with a clause. A disclosure carries
 * no contribution, so the declared reason never counts, and its clause ("self-declared") never
 * repeats the "What this means" block below it.
 */
function isExplained(reason: CardReason): boolean {
  return reason.contribution !== undefined && reason.why !== "";
}

/**
 * The reasons and the caveat sit under their own labels, so the caveat reads as the case against
 * the read rather than as part of its reasoning (ADR-0022).
 */
function ReadBody(props: HoverCardProps) {
  // Held here, not persisted: the card keys this body on its opening, so it starts closed.
  const [whyShown, setWhyShown] = useState<boolean>(false);
  const reasonsId: string = `${props.id}-reasons`;
  // The toggle is drawn only above zero and says "these" or "this" by it.
  const explainedCount: number = props.reasons.filter(isExplained).length;
  // A rescore while the card is open can take away every clause, and the toggle with them: the
  // list closes then, and a clause that comes back later starts hidden.
  useEffect(() => {
    if (explainedCount === 0) setWhyShown(false);
  }, [explainedCount]);
  const whyOpen: boolean = whyShown && explainedCount > 0;
  return (
    <>
      {props.reasons.length > 0 ? (
        <>
          <h3 class="bd-card__label">Why it leans this way</h3>
          <ul id={reasonsId} class={`bd-card__reasons${whyOpen ? " bd-card__reasons--open" : ""}`}>
            {props.reasons.map((reason: CardReason) => (
              <ReasonRow
                key={reason.text}
                reason={reason}
                whyShown={whyOpen && isExplained(reason)}
              />
            ))}
          </ul>
          {explainedCount > 0 ? (
            <button
              type="button"
              class="bd-card__why-toggle"
              aria-expanded={whyOpen}
              aria-controls={reasonsId}
              onClick={() => setWhyShown(!whyOpen)}
            >
              {whyToggleLabel(explainedCount, whyOpen)}
              <svg class="bd-card__chevron" viewBox="0 0 10 6" aria-hidden="true">
                <path d="M1 1l4 4 4-4" />
              </svg>
            </button>
          ) : null}
        </>
      ) : null}
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
      {props.caveat ? (
        <>
          <h3 class="bd-card__label">{caveatLabel(props.tier)}</h3>
          <p class="bd-card__caveat">{props.caveat}</p>
        </>
      ) : null}
      {props.confidenceNote ? <p class="bd-card__note">{props.confidenceNote}</p> : null}
    </>
  );
}

function badgeClass(tier: BadgeTier): string {
  return tier === "typical" ? "human" : tier;
}
