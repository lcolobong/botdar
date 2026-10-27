/**
 * Tier 2 for Reddit's activity history: a same-origin `GET /user/<name>/overview.json?limit=100`
 * with the user's own cookies, made on hover only (it is the dearer of the two Reddit requests and
 * only matters once the card opens). It goes through the same rate limiter as about.json and
 * shares its logged-out pause (401, 403 and the login page all trip it). A 404 means there is no
 * listing to read and is kept as an empty one.
 * Only the oldest item's timestamp and the item count leave the parser (ADR-0025, ADR-0028).
 */
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "../../../core/types";
import { OVERVIEW_PAGE_LIMIT } from "../conventions";
import type { OverviewParseResult } from "../parsers/overview";
import { parseOverviewResponse } from "../parsers/overview";
import type { LoginPause, RedditJsonResult } from "./redditJson";
import { createLoginPause, fetchRedditJson, redditLoginPause } from "./redditJson";

export const OVERVIEW_JSON_SOURCE_ID = "reddit.overviewJson";

export interface OverviewJsonSourceOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Shared with about.json, so a login wall seen here stops both; a pause of its own by default. */
  loginPause?: LoginPause;
}

export function overviewJsonPath(handle: string): string {
  return `/user/${encodeURIComponent(handle)}/overview.json?limit=${OVERVIEW_PAGE_LIMIT}`;
}

export function createOverviewJsonSource(options: OverviewJsonSourceOptions = {}): SignalSource {
  const fetchResponse: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now: () => number = options.now ?? Date.now;
  const loginPause: LoginPause = options.loginPause ?? createLoginPause(now);

  const resolve = async (
    ref: AccountRef,
    context: ResolveContext,
  ): Promise<PartialSignals | null> => {
    if (loginPause.active()) return null;
    const response: RedditJsonResult = await fetchRedditJson({
      fetch: fetchResponse,
      now,
      path: overviewJsonPath(ref.handle),
      signal: context.signal,
      label: "overview.json",
    });
    if (response.status === "loginRequired" || response.status === "forbidden") {
      loginPause.trip();
      return null;
    }
    // A profile with no listing has nothing visible: cached as such, so every hover does not ask again.
    if (response.status === "notFound") {
      return { visibleItemCount: 0 };
    }
    if (response.status !== "ok") return null;
    const result: OverviewParseResult = parseOverviewResponse(response.body);
    return result.status === "ok" ? result.signals : null;
  };

  return {
    id: OVERVIEW_JSON_SOURCE_ID,
    platform: "reddit",
    tier: 2,
    kind: "active",
    hoverOnly: true,
    resolve,
  };
}

export const overviewJsonSource: SignalSource = createOverviewJsonSource({
  loginPause: redditLoginPause,
});
