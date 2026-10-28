/**
 * The hover card's "Why this could be wrong" caveat and its note for sources that did not load,
 * plus the list of every fixed string the card can show, which the wording-rule test reads.
 */

import type {
  AccountSignals,
  Evidence,
  IndependenceGroup,
  SourceTier,
  VerdictTier,
} from "@/src/core/types";
import { accountAgeDays } from "./reasonFormat";
import { isOrdinaryEvidence } from "./reasonSelection";
import { DECLARED_REASONS_BY_SOURCE } from "./reasonTemplates";
import { allFeatureCaveats, allWhyClauses, featureCaveat } from "./whyClauses";

const LONG_LIVED_ACCOUNT_DAYS = 2 * 365;

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
