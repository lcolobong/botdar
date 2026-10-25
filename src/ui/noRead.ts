/**
 * Why a No read card has nothing to read, from where the account's Tier 2 lookup stands. Every
 * platform's wiring shows the same lines, so they live here rather than in each wire.ts.
 */
import type { BadgeHandle, LookupStatus } from "@/src/core/pipeline";
import type { Verdict } from "@/src/core/types";

const PAGE_TOO_THIN = "the page alone shows too little about this account";

const EXPLANATION_BY_STATUS: Readonly<Record<LookupStatus, string>> = {
  pending: "Loading this account's public profile.",
  off: `Profile lookups are off, by conservative mode or a pause in the project's settings file, and ${PAGE_TOO_THIN}.`,
  loginRequired: `The platform answers profile lookups only while you are logged in, and ${PAGE_TOO_THIN}.`,
  empty: `The platform returned no profile details, and ${PAGE_TOO_THIN}.`,
  delivered: "The profile lookup returned too little about this account to read it either way.",
  idle: `Its profile has not been looked up yet, and ${PAGE_TOO_THIN}.`,
};

export function noReadExplanation(status: LookupStatus): string {
  return EXPLANATION_BY_STATUS[status];
}

/** The hover card's `explanation` prop for this verdict: present only on a No read card. */
export function noReadCardProps(verdict: Verdict, handle: BadgeHandle): { explanation?: string } {
  return verdict.tier === "unknown"
    ? { explanation: noReadExplanation(handle.lookupStatus()) }
    : {};
}

/** Every line above, for the wording-rule test. */
export function allNoReadExplanations(): string[] {
  return Object.values(EXPLANATION_BY_STATUS);
}
