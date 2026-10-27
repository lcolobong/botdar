/**
 * How strong a flag one reason is, for the strength bar on the hover card (ADR-0023). Both bounds
 * are thresholds the scoring already uses, so the card never disagrees with it about what counts:
 * strong is what the independence rule counts, and weak is a row listed only to pad the card.
 */
import { REASON_MIN_ABSOLUTE_CONTRIBUTION } from "./reasons";

/** An evidence item counts towards the independence rule (ADR-0003) from this contribution upwards. */
export const STRONG_CONTRIBUTION = 0.6;

/**
 * The bar a reason clears to be listed on its own merit (reasons.ts owns it). Below it a reason
 * only fills the card up to two lines, so "weak" is exactly that padding range.
 */
const MODERATE_CONTRIBUTION: number = REASON_MIN_ABSOLUTE_CONTRIBUTION;

export type ReasonStrength = "weak" | "moderate" | "strong";

/**
 * Buckets a signed contribution by its size, whichever way it points. A reason without one (the
 * declared disclosure) is not weighed evidence and gets no bucket.
 */
export function reasonStrength(contribution: number | undefined): ReasonStrength | undefined {
  if (contribution === undefined) {
    return undefined;
  }
  const magnitude: number = Math.abs(contribution);
  if (magnitude >= STRONG_CONTRIBUTION) {
    return "strong";
  }
  return magnitude >= MODERATE_CONTRIBUTION ? "moderate" : "weak";
}
