/**
 * X ships two user shapes side by side. The 2026 shape keeps identity under `core.*`, counts under
 * `relationship_counts` / `tweet_counts`, the bio under `profile_bio`, the avatar under `avatar`. The
 * older shape keeps all of that under `legacy.*`. The newer field wins whenever both are present.
 */
import type { UnknownRecord } from "@/src/core/json/untrusted";
import { readBoolean, readRecord, readString } from "@/src/core/json/untrusted";
import type { VerifiedKind } from "@/src/core/types";
import type { ParsedXUser } from "./types";

const SCREEN_NAME_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const DEFAULT_AVATAR_PATH_SEGMENT = "default_profile_images";
const MONTH_ABBREVIATIONS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
/** X's own timestamp format, e.g. "Wed Oct 10 20:19:24 +0000 2018". */
const X_TIMESTAMP_PATTERN =
  /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (\d{4})$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

// MARK: - Field readers

export function parseXTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = X_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    const isoMillis: number = ISO_TIMESTAMP_PATTERN.test(value) ? Date.parse(value) : Number.NaN;
    return Number.isFinite(isoMillis) && isoMillis > 0 ? isoMillis : undefined;
  }
  const [, month, day, hours, minutes, seconds, offsetSign, offsetHours, offsetMinutes, year] =
    match;
  const monthIndex: number = MONTH_ABBREVIATIONS.indexOf((month ?? "").toLowerCase());
  if (monthIndex < 0) {
    return undefined;
  }
  const utcMillis: number = Date.UTC(
    Number(year),
    monthIndex,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  );
  const offsetMillis: number =
    (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000 * (offsetSign === "-" ? -1 : 1);
  const millis: number = utcMillis - offsetMillis;
  return Number.isFinite(millis) && millis > 0 ? millis : undefined;
}

export function screenNameOf(node: UnknownRecord): string | undefined {
  const screenName: string | undefined =
    readString(readRecord(node, "core"), "screen_name") ??
    readString(readRecord(node, "legacy"), "screen_name");
  return screenName !== undefined && SCREEN_NAME_PATTERN.test(screenName) ? screenName : undefined;
}

export function verifiedKindOf(node: UnknownRecord): VerifiedKind | undefined {
  const verifiedType: string | undefined = (
    readString(readRecord(node, "verification"), "verified_type") ??
    readString(readRecord(node, "legacy"), "verified_type")
  )?.toLowerCase();
  if (verifiedType === "business") {
    return "org";
  }
  if (verifiedType === "government") {
    return "gov";
  }
  const isBlueVerified: boolean | undefined = readBoolean(node, "is_blue_verified");
  if (isBlueVerified === true) {
    return "blue";
  }
  return isBlueVerified === false || verifiedType !== undefined ? "none" : undefined;
}

export function hasDefaultAvatarOf(node: UnknownRecord): boolean | undefined {
  const legacy: UnknownRecord | undefined = readRecord(node, "legacy");
  const avatarUrl: string | undefined =
    readString(readRecord(node, "avatar"), "image_url") ??
    readString(legacy, "profile_image_url_https");
  const defaultImageFlag: boolean | undefined = readBoolean(legacy, "default_profile_image");
  if (defaultImageFlag === true || avatarUrl?.includes(DEFAULT_AVATAR_PATH_SEGMENT)) {
    return true;
  }
  return defaultImageFlag === false || avatarUrl !== undefined ? false : undefined;
}

// MARK: - Users

export function asUser(node: UnknownRecord): ParsedXUser | undefined {
  const restId: string | undefined = readString(node, "rest_id");
  const screenName: string | undefined = screenNameOf(node);
  if (restId === undefined || screenName === undefined) {
    return undefined;
  }
  return { ref: { platform: "x", handle: screenName.toLowerCase(), id: restId }, node };
}
