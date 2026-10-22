/**
 * Read-only view of the policy state for the extension pages: the cached copy and the last refresh
 * attempt, plus the wording the popup and the options page derive from them.
 */
import { browser } from "wxt/browser";
import { POLICY_LAST_ATTEMPT_KEY, loadLastKnownGood } from "@/src/core/policy/loader";
import type { LastKnownGoodPolicy, PolicyAttempt } from "@/src/core/policy/loader";

export interface PolicyStatus {
  lastKnownGood: LastKnownGoodPolicy | null;
  lastAttempt: PolicyAttempt | null;
}

export const POLICY_NOT_FETCHED = "Policy not fetched yet";
export const POLICY_UPDATE_FAILED = "Policy update failed; using the last good copy";

const DAY_MS = 86_400_000;

function isPolicyAttempt(value: unknown): value is PolicyAttempt {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof record.at === "number" &&
    typeof record.ok === "boolean" &&
    (record.error === undefined || typeof record.error === "string")
  );
}

/** Stored data is untrusted: a malformed attempt reads as "no attempt yet". */
export async function loadPolicyStatus(): Promise<PolicyStatus> {
  const [lastKnownGood, stored]: [LastKnownGoodPolicy | null, Record<string, unknown>] =
    await Promise.all([loadLastKnownGood(), browser.storage.local.get(POLICY_LAST_ATTEMPT_KEY)]);
  const attempt: unknown = stored[POLICY_LAST_ATTEMPT_KEY];
  return { lastKnownGood, lastAttempt: isPolicyAttempt(attempt) ? attempt : null };
}

/** Whole days, never negative: "today", "1 day ago", "N days ago". */
export function describeAge(at: number, now: number): string {
  const days: number = Math.max(0, Math.floor((now - at) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/** The popup's status caption. */
export function policyStatusLine(status: PolicyStatus, now: number): string {
  if (status.lastKnownGood === null) return POLICY_NOT_FETCHED;
  if (status.lastAttempt?.ok === false) return POLICY_UPDATE_FAILED;
  return `Policy updated ${describeAge(status.lastKnownGood.fetchedAt, now)}`;
}

export const POLICY_HOST = "lcolobong.github.io";
export const POLICY_RESTRICT_ONLY = "It can only turn features off, never on.";

/** The options page's policy row title. */
export function policyVersionLine(status: PolicyStatus): string {
  const failed: boolean = status.lastAttempt?.ok === false;
  if (status.lastKnownGood === null) {
    return failed ? "Policy update failed; using the build defaults" : POLICY_NOT_FETCHED;
  }
  const version: number = status.lastKnownGood.policy.version;
  return failed
    ? `Version ${version}, last update failed`
    : `Version ${version}, signature verified`;
}

/** The options page's policy row caption. */
export function policyFetchedLine(status: PolicyStatus, now: number): string {
  if (status.lastKnownGood === null) return `Using the build defaults. ${POLICY_RESTRICT_ONLY}`;
  const age: string = describeAge(status.lastKnownGood.fetchedAt, now);
  return `Fetched ${age} from ${POLICY_HOST}. ${POLICY_RESTRICT_ONLY}`;
}
