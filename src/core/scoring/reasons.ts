/**
 * Reason selection and the hover card's caveats. The per-feature reason templates live in
 * reasonTemplates.ts and are re-exported here; the shared number and duration formatting is in
 * reasonFormat.ts.
 */

import type {
  AccountSignals,
  Evidence,
  IndependenceGroup,
  ReasonDirection,
  SourceTier,
  VerdictReason,
  VerdictTier,
} from "../types";
import { accountAgeDays } from "./reasonFormat";
import { DECLARED_REASONS_BY_SOURCE, NO_REASON } from "./reasonTemplates";
import {
  allFeatureCaveats,
  allWhyClauses,
  directionFor,
  featureCaveat,
  whyFor,
} from "./whyClauses";

export {
  DECLARED_REASON,
  DECLARED_REASONS_BY_SOURCE,
  NO_REASON,
  declaredReasonFor,
  renderReason,
  templatedFeatureIds,
} from "./reasonTemplates";
export type { ReasonContext } from "./reasonTemplates";

const LONG_LIVED_ACCOUNT_DAYS = 2 * 365;
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

const GROUP_CAVEATS: Readonly<Record<IndependenceGroup, string>> = {
  activity: "High-volume human posters, news desks and brand accounts show the same pattern.",
  age: "Every account was new once; a recent join date means little on its own.",
  graph: "People who follow widely before anyone follows back look the same.",
  handle: "Many people accept the platform's suggested handle and never change it.",
  profile: "Privacy-minded people often leave profiles blank.",
  verification: "Paid verification is available to any new account.",
  content: "Some people only ever reply; that is a style, not automation.",
  geo: "Expats, travellers, VPN users and people writing in a second language look the same.",
  timing: "Accounts that schedule posts with a publishing tool show the same regularity.",
  coordination: "People reacting to the same post often say the same thing.",
};

/** The case against a read led by `item`: the feature's own counter-case, else its group's. */
function counterCaseFor(item: Evidence): string {
  return featureCaveat(item.feature) ?? GROUP_CAVEATS[item.group];
}

/**
 * The case against a Likely human read, keyed on the group of its strongest ordinary evidence: what
 * would make that evidence look the same on an automated account.
 */
const TYPICAL_COUNTER_CASES: Readonly<Partial<Record<IndependenceGroup, string>>> = {
  age: "An aged account can be bought and repurposed.",
  graph: "Followers can be bought.",
  profile: "A persona account fills its profile in too.",
};

const SOURCES_MISSING_CLOSING = "Some signals could not be loaded, so this read is less certain.";
const LONG_LIVED_CLOSING = "Long-lived accounts are rarely automated; weigh this lightly.";
const DECLARED_CLOSING =
  "The account operator chose to label it as automated. That is the platform's recommended, transparent practice.";
/** A Likely human card's caveat when its ordinary evidence has no counter-case of its own. */
const TYPICAL_CLOSING = "These signals look like an ordinary account.";
const UNKNOWN_CLOSING = "Too little is visible about this account to read it either way.";

export interface CaveatContext {
  tier: VerdictTier;
  evidenceByMagnitude: Evidence[];
  signals: AccountSignals;
  now: number;
  sourcesMissing: SourceTier[];
}

function typicalCounterCase(evidenceByMagnitude: Evidence[]): string {
  const dominant: Evidence | undefined = evidenceByMagnitude.find(isOrdinaryEvidence);
  return (
    (dominant === undefined ? undefined : TYPICAL_COUNTER_CASES[dominant.group]) ?? TYPICAL_CLOSING
  );
}

export function caveatFor(context: CaveatContext): string {
  if (context.tier === "declared") {
    return DECLARED_CLOSING;
  }
  if (context.tier === "unknown") {
    return UNKNOWN_CLOSING;
  }
  if (context.tier === "typical") {
    const counterCase: string = typicalCounterCase(context.evidenceByMagnitude);
    return context.sourcesMissing.length > 0
      ? `${counterCase} ${SOURCES_MISSING_CLOSING}`
      : counterCase;
  }
  const dominant: Evidence | undefined =
    context.evidenceByMagnitude.find((item) => item.contribution > 0) ??
    context.evidenceByMagnitude[0];
  const groupCaveat: string | undefined =
    dominant === undefined ? undefined : counterCaseFor(dominant);

  // The "Why this could be wrong" label and the group sentence carry the disclaimer, so a closer is
  // added only when it states something factual about this read.
  const ageDays: number | undefined = accountAgeDays(context.signals, context.now);
  let closing: string | undefined;
  if (ageDays !== undefined && ageDays >= LONG_LIVED_ACCOUNT_DAYS) {
    closing = LONG_LIVED_CLOSING;
  } else if (context.sourcesMissing.length > 0) {
    closing = SOURCES_MISSING_CLOSING;
  }
  return [groupCaveat, closing].filter((part) => part !== undefined).join(" ");
}

function missingTierNote(tier: SourceTier, available: boolean): string {
  switch (tier) {
    case 0:
      return "Page details not loaded yet";
    case 1:
      return available ? "Profile details not loaded yet" : "Profile details are off";
    case 2:
      return available ? "Extra lookups not run yet" : "Extra lookups are off";
  }
}

export function confidenceNoteFor(
  sourcesMissing: SourceTier[],
  sourcesAvailable: SourceTier[],
): string | undefined {
  if (sourcesMissing.length === 0) {
    return undefined;
  }
  return sourcesMissing
    .map((tier) => missingTierNote(tier, sourcesAvailable.includes(tier)))
    .join(". ");
}

/** Every fixed string that can reach the hover card, for the wording-rule test. */
export function allFixedStrings(): string[] {
  return [
    ...Object.values(DECLARED_REASONS_BY_SOURCE),
    ...allWhyClauses(),
    ...Object.values(GROUP_CAVEATS),
    ...allFeatureCaveats(),
    ...Object.values(TYPICAL_COUNTER_CASES),
    SOURCES_MISSING_CLOSING,
    LONG_LIVED_CLOSING,
    DECLARED_CLOSING,
    TYPICAL_CLOSING,
    UNKNOWN_CLOSING,
    ...([0, 1, 2] as const).flatMap((tier) => [
      missingTierNote(tier, true),
      missingTierNote(tier, false),
    ]),
  ];
}
