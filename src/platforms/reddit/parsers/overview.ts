/**
 * Tier 2 parser for Reddit `/user/<name>/overview.json?limit=100`: the user's latest posts and
 * comments as a listing. Only each item's `created_utc` and the number of items are read; titles,
 * bodies and subreddits are never looked at, so nothing but two numbers can leave this module
 * (ADR-0025). The body is untrusted page data and nothing here throws.
 */
import type { UnknownRecord } from "../../../core/json/untrusted";
import { isRecord, readNumber, readRecord, readString } from "../../../core/json/untrusted";
import type { PartialSignals } from "../../../core/types";
import { OVERVIEW_PAGE_LIMIT } from "../conventions";

const LISTING_KIND = "Listing";
const MILLIS_PER_SECOND = 1000;

export type OverviewParseResult =
  { status: "ok"; signals: PartialSignals } | { status: "unavailable" };

function createdMillisOf(child: unknown): number | undefined {
  const createdSeconds: number | undefined = readNumber(
    isRecord(child) ? readRecord(child, "data") : undefined,
    "created_utc",
  );
  return createdSeconds !== undefined && createdSeconds > 0
    ? Math.round(createdSeconds * MILLIS_PER_SECOND)
    : undefined;
}

export function parseOverviewResponse(body: unknown): OverviewParseResult {
  if (!isRecord(body) || body.kind !== LISTING_KIND) {
    return { status: "unavailable" };
  }
  const data: UnknownRecord | undefined = readRecord(body, "data");
  const children: unknown = data?.children;
  if (data === undefined || !Array.isArray(children)) {
    return { status: "unavailable" };
  }
  const createdMillis: number[] = children
    .slice(0, OVERVIEW_PAGE_LIMIT)
    .flatMap((child: unknown) => {
      const created: number | undefined = createdMillisOf(child);
      return created === undefined ? [] : [created];
    });
  // A listing that points at a next page is not the whole history, whatever it carried.
  const continues: boolean = (readString(data, "after") ?? "").length > 0;
  const signals: PartialSignals = {
    visibleItemCount: continues ? OVERVIEW_PAGE_LIMIT : createdMillis.length,
  };
  if (createdMillis.length > 0) {
    signals.oldestItemAt = Math.min(...createdMillis);
  }
  return { status: "ok", signals };
}
