/**
 * Neutral, factual wording for the hover card's reason lines: one template per feature id and one
 * line per way an account declares itself automated. Every string here is governed by the wording
 * rules in docs/scoring-spec.md and ADR-0003: observations with numbers, never a description of the
 * person.
 * Templates also word evidence that points towards an ordinary account, since a Likely human card
 * lists it too; a template returns NO_REASON when its value has nothing true to say.
 */

import type { AccountSignals, DeclaredBy, FeatureId } from "@/src/core/types";
import {
  DAY_MS,
  accountAgeDays,
  formatCount,
  formatDuration,
  formatDurationAdjective,
  pluralize,
} from "./reasonFormat";

export interface ReasonContext {
  value: number | boolean;
  /** After per-feature and group caps; the sign picks the wording for age features. */
  contribution: number;
  signals: AccountSignals;
  /** Epoch milliseconds. */
  now: number;
  /** The feature's `detail`, when it carries one. */
  detail?: string;
}

type ReasonTemplate = (context: ReasonContext) => string;

/**
 * A pattern that is absent ("handle has no digits", "not verified early") is not an observation
 * worth a line, and the old fixed strings would have stated the opposite of the value.
 */
export const NO_REASON = "";

/** Join dates this recent read as "3 weeks ago"; older ones as "March 2019". */
const RELATIVE_JOIN_DATE_LIMIT_DAYS = 90;

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

const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
const monthYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

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

/** "~120 karma/day since first activity 3 months ago": the rate's window is the activity, not the account. */
function karmaSinceFirstActivityReason({ value, signals, now }: ReasonContext): string {
  const rate: string = `~${formatCount(Number(value))} karma/day since first activity`;
  if (signals.oldestItemAt === undefined) {
    return rate;
  }
  const days: number = (now - signals.oldestItemAt) / DAY_MS;
  // formatDuration would print "0 days ago" for a span under half a day.
  return days < 1 ? `${rate} today` : `${rate} ${formatDuration(days)} ago`;
}

/** "1,530 posts and comments in 3 years": a rate under one a day reads better as a count. */
function submissionsReason({ signals, now }: ReasonContext): string {
  const count: string = formatCount(signals.postCount ?? 0);
  const days: number | undefined = accountAgeDays(signals, now);
  return days === undefined
    ? `${count} posts and comments`
    : `${count} posts and comments in ${formatDuration(days)}`;
}

function karmaSplitReason({ signals }: ReasonContext): string {
  const link: string = formatCount(signals.linkKarma ?? 0);
  const comment: string = formatCount(signals.commentKarma ?? 0);
  return `Post karma ${link}, comment karma ${comment}`;
}

/** "Based in Brazil, writes in Russian": both halves of the comparison the feature made. */
function countryMismatchReason({ value, signals, detail }: ReasonContext): string {
  if (value === false) {
    return NO_REASON;
  }
  const languageName: string | undefined =
    detail === undefined ? undefined : languageNames.of(detail);
  if (signals.country === undefined) {
    return "Listed country differs from the account's language";
  }
  return languageName === undefined
    ? `Account based in ${signals.country}`
    : `Based in ${signals.country}, writes in ${languageName}`;
}

/** Irregular gaps and a nightly lull are what most accounts show; only the pattern is worded. */
function regularGapsReason({ contribution }: ReasonContext): string {
  return contribution > 0 ? "Posts at regular intervals" : NO_REASON;
}

function roundTheClockReason({ contribution }: ReasonContext): string {
  return contribution > 0 ? "Posts around the clock" : NO_REASON;
}

/** The value counts other accounts, not their replies: one account repeating itself counts once. */
function nearDuplicateReplyReason({ value, contribution }: ReasonContext): string {
  const otherAccounts: number = Number(value);
  if (contribution <= 0 || otherAccounts < 1) {
    return NO_REASON;
  }
  return otherAccounts === 1
    ? "Reply closely matches an earlier one by another account"
    : `Reply closely matches earlier ones by ${formatCount(otherAccounts)} other accounts`;
}

/** Like the near-duplicate line, the value counts other accounts, each once. */
function sharedRareDomainReason({ value, contribution }: ReasonContext): string {
  const otherAccounts: number = Number(value);
  if (contribution <= 0 || otherAccounts < 1) {
    return NO_REASON;
  }
  return otherAccounts === 1
    ? "Links a site another account linked earlier in this thread"
    : `Links a site ${formatCount(otherAccounts)} other accounts linked earlier in this thread`;
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
  "x.countryLocaleMismatch": countryMismatchReason,
  "x.gapRegularity": regularGapsReason,
  "bsky.gapRegularity": regularGapsReason,
  "x.noSleepWindow": roundTheClockReason,
  "bsky.noSleepWindow": roundTheClockReason,
  "thread.nearDuplicateReply": nearDuplicateReplyReason,
  "thread.sharedRareDomain": sharedRareDomainReason,
  "reddit.karmaPerDay": karmaPerDayReason,
  "reddit.karmaSinceFirstActivity": karmaSinceFirstActivityReason,
  "reddit.postToCommentKarma": karmaSplitReason,
  "reddit.generatedName": ({ value }) =>
    value === false ? NO_REASON : "Username matches Reddit's auto-generated pattern",
  "reddit.noAvatar": ({ value }) => (value === false ? "Custom avatar" : "Default avatar"),
  "reddit.noVerifiedEmail": ({ value }) =>
    value === false ? "Verified email" : "No verified email",
  "hn.accountAgeDays": joinedReason,
  "hn.karmaPerDay": karmaPerDayReason,
  "hn.submissionsPerDay": submissionsReason,
  "hn.hasAbout": ({ value }) => (value === true ? "Has an about section" : NO_REASON),
  "youtube.channelAgeDays": joinedReason,
  "youtube.hasVideos": ({ value, signals }) =>
    value === true ? `Has ${pluralize(signals.postCount ?? 0, "public video")}` : NO_REASON,
  "youtube.hasDescription": ({ value }) =>
    value === true ? "Has a channel description" : NO_REASON,
  "youtube.assignedHandle": ({ value }) =>
    value === true ? "Handle is one YouTube assigned" : NO_REASON,
  "youtube.imitatesCreator": ({ detail }) =>
    detail === "name"
      ? "Channel name imitates this video's creator"
      : "Handle imitates this video's creator",
};

export function templatedFeatureIds(): FeatureId[] {
  return Object.keys(REASON_TEMPLATES);
}

/** A feature without a template renders its id, so a missing template is visible, never silent. */
export function renderReason(featureId: FeatureId, context: ReasonContext): string {
  const template: ReasonTemplate | undefined = REASON_TEMPLATES[featureId];
  return template === undefined ? featureId : template(context);
}
