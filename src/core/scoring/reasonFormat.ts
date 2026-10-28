/**
 * Count, duration and account-age formatting shared by the reason templates and the caveats, so
 * every line on the hover card counts and dates things the same way.
 */

import type { AccountSignals } from "@/src/core/types";

export const DAY_MS = 24 * 60 * 60 * 1000;

const countFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return countFormat.format(value);
}

export function pluralize(count: number, unit: string): string {
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
export function formatDuration(days: number): string {
  const duration: Duration = durationFromDays(days);
  return pluralize(duration.count, duration.unit);
}

/** "3-week", for "a 3-week-old account". */
export function formatDurationAdjective(days: number): string {
  const duration: Duration = durationFromDays(days);
  return `${formatCount(duration.count)}-${duration.unit}`;
}

export function accountAgeDays(signals: AccountSignals, now: number): number | undefined {
  return signals.createdAt === undefined ? undefined : (now - signals.createdAt) / DAY_MS;
}
