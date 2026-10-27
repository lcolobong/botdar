/**
 * Type-guarded readers for untrusted JSON: relayed page bodies and platform responses. Every reader
 * returns undefined for a value of the wrong type instead of throwing or coercing, so a parser built
 * on them yields partial results from a mangled body.
 */

export type UnknownRecord = Record<string, unknown>;

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRecord(
  parent: UnknownRecord | undefined,
  key: string,
): UnknownRecord | undefined {
  const value: unknown = parent?.[key];
  return isRecord(value) ? value : undefined;
}

export function readString(parent: UnknownRecord | undefined, key: string): string | undefined {
  const value: unknown = parent?.[key];
  return typeof value === "string" ? value : undefined;
}

export function readBoolean(parent: UnknownRecord | undefined, key: string): boolean | undefined {
  const value: unknown = parent?.[key];
  return typeof value === "boolean" ? value : undefined;
}

/** Non-negative safe integers only; a count serialised as a string stays unobserved. */
export function readCount(parent: UnknownRecord | undefined, key: string): number | undefined {
  const value: unknown = parent?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Epoch milliseconds of an ISO 8601 date-time string; undefined for anything else or for 1970. */
export function isoTimestampMillis(value: string | undefined): number | undefined {
  if (value === undefined || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return undefined;
  }
  const millis: number = Date.parse(value);
  return Number.isFinite(millis) && millis > 0 ? millis : undefined;
}
