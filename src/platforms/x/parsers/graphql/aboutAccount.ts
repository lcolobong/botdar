import type { UnknownRecord } from "@/src/core/json/untrusted";
import { isRecord, readRecord, readString } from "@/src/core/json/untrusted";
import type { PartialSignals } from "@/src/core/types";
import { declaredAutomatedOf } from "./automatedLabel";
import { screenNameOf } from "./userFields";

export interface ParsedAboutAccount {
  handle: string;
  country?: string;
  usernameChanges?: number;
  appStore?: string;
  declaredAutomated?: boolean;
}

const MAX_COUNTRY_LENGTH = 64;
const MAX_APP_STORE_LENGTH = 32;

// MARK: - AboutAccountQuery

/** Tier 2 projection of `AboutAccountQuery`; null when the body is not that response. */
export function parseAboutAccount(body: unknown): ParsedAboutAccount | null {
  if (!isRecord(body)) {
    return null;
  }
  const result: UnknownRecord | undefined = readRecord(
    readRecord(readRecord(body, "data"), "user_result_by_screen_name"),
    "result",
  );
  const screenName: string | undefined = result === undefined ? undefined : screenNameOf(result);
  if (result === undefined || screenName === undefined) {
    return null;
  }
  const aboutProfile: UnknownRecord | undefined = readRecord(result, "about_profile");
  const parsed: ParsedAboutAccount = { handle: screenName.toLowerCase() };

  const country: string = readString(aboutProfile, "account_based_in")?.trim() ?? "";
  if (country.length > 0) {
    parsed.country = country.slice(0, MAX_COUNTRY_LENGTH);
  }
  // The count has been seen both as a number and as a decimal string.
  const rawChanges: unknown = readRecord(aboutProfile, "username_changes")?.count;
  const usernameChanges: number =
    typeof rawChanges === "number" ? rawChanges : Number.parseInt(String(rawChanges ?? ""), 10);
  if (Number.isSafeInteger(usernameChanges) && usernameChanges >= 0) {
    parsed.usernameChanges = usernameChanges;
  }
  const appStore: string = readString(aboutProfile, "source")?.trim() ?? "";
  if (appStore.length > 0) {
    parsed.appStore = appStore.slice(0, MAX_APP_STORE_LENGTH);
  }
  const declaredAutomated: boolean | undefined = declaredAutomatedOf(result);
  if (declaredAutomated !== undefined) {
    parsed.declaredAutomated = declaredAutomated;
  }
  return parsed;
}

/** The AboutAccountQuery projection as signals; the handle stays on the caller's AccountRef. */
export function toAboutSignals(parsed: ParsedAboutAccount): PartialSignals {
  const signals: PartialSignals = {};
  if (parsed.country !== undefined) {
    signals.country = parsed.country;
  }
  if (parsed.usernameChanges !== undefined) {
    signals.usernameChanges = parsed.usernameChanges;
  }
  if (parsed.appStore !== undefined) {
    signals.appStore = parsed.appStore;
  }
  if (parsed.declaredAutomated !== undefined) {
    signals.declaredAutomated = parsed.declaredAutomated;
  }
  return signals;
}
