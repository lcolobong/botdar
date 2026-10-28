/**
 * The hover card's wording surface. The code lives beside it: the per-feature reason templates in
 * reasonTemplates.ts, the number and duration formatting they share in reasonFormat.ts, which
 * reasons a card lists in reasonSelection.ts, and the caveat and missing-source note in caveats.ts.
 */
export { allFixedStrings, caveatFor, confidenceNoteFor } from "./caveats";
export type { CaveatContext } from "./caveats";
export {
  REASON_MIN_ABSOLUTE_CONTRIBUTION,
  isOrdinaryEvidence,
  selectReasons,
} from "./reasonSelection";
export {
  DECLARED_REASON,
  DECLARED_REASONS_BY_SOURCE,
  NO_REASON,
  declaredReasonFor,
  renderReason,
  templatedFeatureIds,
} from "./reasonTemplates";
export type { ReasonContext } from "./reasonTemplates";
