/**
 * Which worded evidence a card lists, and which way each listed reason points. A card shows two to
 * four reasons; the strength bar's "weak" range is the padding below the listing threshold.
 */

import type { Evidence, ReasonDirection, VerdictReason } from "@/src/core/types";
import { NO_REASON } from "./reasonTemplates";
import { directionFor, whyFor } from "./whyClauses";

/**
 * A reason is listed on its own merit from this contribution up; below it, it only pads the card
 * to two reasons. The card's strength bar calls that padding range "weak" (strength.ts).
 */
export const REASON_MIN_ABSOLUTE_CONTRIBUTION = 0.3;
const MIN_REASONS = 2;
const MAX_REASONS = 4;

/**
 * Worded evidence that the card shows pointing towards an ordinary account. The Likely human rule,
 * the card's arrow and the Likely human counter-case all use this one test, so a reason can never
 * vouch for an account while its row points towards automated.
 */
export function isOrdinaryEvidence(item: Evidence): boolean {
  return item.reason !== NO_REASON && directionFor(item.feature, item.contribution) === "ordinary";
}

function verdictReasonFor(item: Evidence): VerdictReason {
  const direction: ReasonDirection = isOrdinaryEvidence(item) ? "ordinary" : "automated";
  return {
    text: item.reason,
    why: whyFor(item.feature, direction),
    direction,
    contribution: item.contribution,
    tier: item.tier,
  };
}

/**
 * Top reasons by magnitude; weak evidence fills in only when fewer than two clear the bar. Evidence
 * whose template had nothing to say is never shown, so the fill-in takes the next worded item. Two
 * features can word the same observation (both handle-digit features read "Handle is a name followed
 * by 5 digits"), so a repeated line keeps only its stronger item: the card lists each line once and
 * keys its rows on the text.
 */
export function selectReasons(evidenceByMagnitude: Evidence[]): VerdictReason[] {
  const seenTexts = new Set<string>();
  const worded: Evidence[] = evidenceByMagnitude.filter((item) => {
    if (item.reason === NO_REASON || seenTexts.has(item.reason)) {
      return false;
    }
    seenTexts.add(item.reason);
    return true;
  });
  const material: Evidence[] = worded.filter(
    (item) => Math.abs(item.contribution) >= REASON_MIN_ABSOLUTE_CONTRIBUTION,
  );
  const selected: Evidence[] =
    material.length >= MIN_REASONS ? material : worded.slice(0, MIN_REASONS);
  return selected.slice(0, MAX_REASONS).map(verdictReasonFor);
}
