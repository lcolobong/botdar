/**
 * Tier 1 parser for X GraphQL responses (HomeTimeline, TweetDetail, UserByScreenName, SearchTimeline,
 * UserTweets, AboutAccountQuery). Bodies are untrusted page data: every read is type-guarded, strings
 * are capped, the walk is bounded, and nothing here throws.
 *
 * X ships two user shapes side by side. The 2026 shape keeps identity under `core.*`, counts under
 * `relationship_counts` / `tweet_counts`, the bio under `profile_bio`, the avatar under `avatar`. The
 * older shape keeps all of that under `legacy.*`. The newer field wins whenever both are present.
 * Posts keep their text under `legacy.full_text` and their author under `core.user_results.result`.
 */
import type { UnknownRecord } from "../../../core/json/untrusted";
import { isRecord, readRecord, readString } from "../../../core/json/untrusted";
import type { PartialSignals } from "../../../core/types";
import { declaredAutomatedOf } from "./graphql/automatedLabel";
import type { ParsedAboutAccount } from "./graphql/types";
import { screenNameOf } from "./graphql/userFields";

export {
  profileTimelineUserIdOf,
  repliesTabOwnerTweets,
  timelineOwnerPosts,
} from "./graphql/ownerPosts";
export type { OwnerPosts, TimelineOwnerPosts } from "./graphql/ownerPosts";
export { toSignals } from "./graphql/signals";
export { collectUsers, parseGraphqlBody, postTextByHandle } from "./graphql/walk";
export type { ParsedAboutAccount, ParsedXBody, ParsedXPost, ParsedXUser } from "./graphql/types";
export { parseXTimestamp } from "./graphql/userFields";

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
