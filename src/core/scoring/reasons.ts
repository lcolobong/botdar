/**
 * Neutral, factual wording for the hover card: one template per feature id, a caveat per dominant
 * group and a note for missing sources. Every string here is governed by the wording rules in
 * docs/scoring-spec.md and ADR-0003: observations with numbers, never a description of the person.
 * Templates also word evidence that points towards an ordinary account, since a Likely human card
 * lists it too; a template returns NO_REASON when its value has nothing true to say.
 */

import type {
  AccountSignals,
  Evidence,
  FeatureId,
  IndependenceGroup,
  ReasonDirection,
  SourceTier,
  VerdictReason,
  VerdictTier,
  DeclaredBy,
} from "../types";
import { allWhyClauses, directionFor, whyFor } from "./whyClauses";

export interface ReasonContext {
  value: number | boolean;
  /** After per-feature and group caps; the sign picks the wording for age features. */
  contribution: number;
  signals: AccountSignals;
  /** Epoch milliseconds. */
  now: number;
}

type ReasonTemplate = (context: ReasonContext) => string;

/**
 * A pattern that is absent ("handle has no digits", "not verified early") is not an observation
 * worth a line, and the old fixed strings would have stated the opposite of the value.
 */
export const NO_REASON = "";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Join dates this recent read as "3 weeks ago"; older ones as "March 2019". */
const RELATIVE_JOIN_DATE_LIMIT_DAYS = 90;
const LONG_LIVED_ACCOUNT_DAYS = 2 * 365;
/**
 * A reason is listed on its own merit from this contribution up; below it, it only pads the card
 * to two reasons. The card's strength bar calls that padding range "weak" (strength.ts).
 */
export const REASON_MIN_ABSOLUTE_CONTRIBUTION = 0.3;
const MIN_REASONS = 2;
const MAX_REASONS = 4;

export const DECLARED_REASON = "Carries the platform's own automated-account label";
/** One reason per way an account can declare itself (src/core/handle/selfDescription.ts). */
export const DECLARED_REASONS_BY_SOURCE: Readonly<Record<DeclaredBy, string>> = {
  label: DECLARED_REASON,
  flair: "Its flair describes the account as automated",
  name: "Its username describes the account as automated",
  bio: "Its bio describes the account as automated",
};

export function declaredReasonFor(signals: Pick<AccountSignals, "declaredBy">): string {
  return DECLARED_REASONS_BY_SOURCE[signals.declaredBy ?? "label"];
}

const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const monthYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatCount(value: number): string {
  return countFormat.format(value);
}

function pluralize(count: number, unit: string): string {
  return `${formatCount(count)} ${unit}${count === 1 ? "" : "s"}`;
}

interface Duration {
  count: number;
  unit: "day" | "week" | "month" | "year";
}

function durationFromDays(days: number): Duration {
  const wholeDays: number = Math.max(0, Math.round(days));
  if (wholeDays < 14) {
    return { count: wholeDays, unit: "day" };
  }
  if (wholeDays < 60) {
    return { count: Math.round(wholeDays / 7), unit: "week" };
  }
  if (wholeDays < 365) {
    return { count: Math.round(wholeDays / 30.44), unit: "month" };
  }
  return { count: Math.round(wholeDays / 365.25), unit: "year" };
}

/** "3 weeks", "6 years". */
function formatDuration(days: number): string {
  const duration: Duration = durationFromDays(days);
  return pluralize(duration.count, duration.unit);
}

/** "3-week", for "a 3-week-old account". */
function formatDurationAdjective(days: number): string {
  const duration: Duration = durationFromDays(days);
  return `${formatCount(duration.count)}-${duration.unit}`;
}

function accountAgeDays(signals: AccountSignals, now: number): number | undefined {
  return signals.createdAt === undefined ? undefined : (now - signals.createdAt) / DAY_MS;
}

function joinedReason({ value, contribution, signals, now }: ReasonContext): string {
  const days: number = typeof value === "number" ? value : (accountAgeDays(signals, now) ?? 0);
  if (contribution < 0) {
    return `Account is ${formatDuration(days)} old`;
  }
  if (days < RELATIVE_JOIN_DATE_LIMIT_DAYS || signals.createdAt === undefined) {
    return `Joined ${formatDuration(days)} ago`;
  }
  return `Joined ${monthYearFormat.format(new Date(signals.createdAt))}`;
}

function postsPerDayReason({ value }: ReasonContext): string {
  return `~${formatCount(Number(value))} posts/day since joining`;
}

function followRatioReason({ contribution, signals }: ReasonContext): string {
  const { following, followers } = signals;
  if (contribution < 0) {
    return following === undefined || followers === undefined
      ? "Followed by more accounts than it follows"
      : `Followed by ${formatCount(followers)}, following ${formatCount(following)}`;
  }
  if (following === undefined || followers === undefined) {
    return "Follows many more accounts than follow it back";
  }
  return `Following ${formatCount(following)}, followed by ${formatCount(followers)}`;
}

function trailingDigitCount(handle: string): number {
  const localPart: string = handle.split(".")[0] ?? handle;
  return /\d+$/.exec(localPart)?.[0].length ?? 0;
}

function handleDigitsReason({ value, contribution, signals }: ReasonContext): string {
  if (value === false || contribution <= 0) {
    return NO_REASON;
  }
  const digits: number = typeof value === "number" ? value : trailingDigitCount(signals.ref.handle);
  return `Handle is a name followed by ${pluralize(digits, "digit")}`;
}

function avatarAndBioReason({ value, signals }: ReasonContext): string {
  if (value === 2) {
    return "No profile photo and no bio";
  }
  if (value === 1) {
    return signals.hasDefaultAvatar === true ? "No profile photo" : "No bio";
  }
  return "Has a profile photo and a bio";
}

function newAndBlueReason({ value, signals, now }: ReasonContext): string {
  if (value === false) {
    return NO_REASON;
  }
  const days: number | undefined = accountAgeDays(signals, now);
  return days === undefined
    ? "Verified soon after joining"
    : `Verified within ${formatDuration(days)} of joining`;
}

function karmaPerDayReason({ value, signals, now }: ReasonContext): string {
  const rate: string = `~${formatCount(Number(value))} karma/day`;
  const days: number | undefined = accountAgeDays(signals, now);
  return days === undefined
    ? `${rate} since joining`
    : `${rate} on a ${formatDurationAdjective(days)}-old account`;
}

function karmaSplitReason({ signals }: ReasonContext): string {
  const link: string = formatCount(signals.linkKarma ?? 0);
  const comment: string = formatCount(signals.commentKarma ?? 0);
  return `Post karma ${link}, comment karma ${comment}`;
}

const REASON_TEMPLATES: Readonly<Record<FeatureId, ReasonTemplate>> = {
  "x.postsPerDay": postsPerDayReason,
  "bsky.postsPerDay": postsPerDayReason,
  "x.accountAgeDays": joinedReason,
  "reddit.accountAgeDays": joinedReason,
  "bsky.accountAgeDays": joinedReason,
  "x.followingRatio": followRatioReason,
  "bsky.followsRatio": followRatioReason,
  "x.handleNameDigits": handleDigitsReason,
  "x.handleTrailingDigits": handleDigitsReason,
  "bsky.handleDigitsOnBskySocial": handleDigitsReason,
  "x.handleBigramLL": ({ contribution }) =>
    contribution > 0 ? "Handle looks randomly generated" : NO_REASON,
  "x.defaultAvatarEmptyBio": avatarAndBioReason,
  "bsky.noAvatarEmptyBio": avatarAndBioReason,
  "x.newAndBlue": newAndBlueReason,
  "x.replyShare": ({ value }) => `${formatCount(Number(value) * 100)}% of recent posts are replies`,
  "x.usernameChanges": ({ value }) => `Username changed ${pluralize(Number(value), "time")}`,
  "x.countryLocaleMismatch": ({ value, signals }) => {
    if (value === false) {
      return NO_REASON;
    }
    return signals.country === undefined
      ? "Listed country differs from the bio's language"
      : `Account based in ${signals.country}`;
  },
  "reddit.karmaPerDay": karmaPerDayReason,
  "reddit.postToCommentKarma": karmaSplitReason,
  "reddit.generatedName": ({ value }) =>
    value === false ? NO_REASON : "Username matches Reddit's auto-generated pattern",
  "reddit.noAvatar": ({ value }) => (value === false ? "Custom avatar" : "Default avatar"),
  "reddit.noVerifiedEmail": ({ value }) =>
    value === false ? "Verified email" : "No verified email",
};

export function templatedFeatureIds(): FeatureId[] {
  return Object.keys(REASON_TEMPLATES);
}

/** A feature without a template renders its id, so a missing template is visible, never silent. */
export function renderReason(featureId: FeatureId, context: ReasonContext): string {
  const template: ReasonTemplate | undefined = REASON_TEMPLATES[featureId];
  return template === undefined ? featureId : template(context);
}

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
  geo: "Location is inferred by the platform and is often wrong for travellers and VPN users.",
};

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
    dominant === undefined ? undefined : GROUP_CAVEATS[dominant.group];

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
