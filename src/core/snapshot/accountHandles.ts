/**
 * Where each platform names an account in a serialized page, and the fake that replaces each name.
 * Hacker News and YouTube read their handles in hackerNews.ts and youTube.ts; the rest are matched
 * here by the characters a handle may hold.
 */
import { isHandleLongEnough } from "../handleRules.ts";
import { NAME_THEN_DIGITS, fakeHandle } from "./fakeNames.ts";
import { hackerNewsHandles } from "./hackerNews.ts";
import { youTubeFakeHandle, youTubeHandles } from "./youTube.ts";

import type { PlatformId } from "../types.ts";

/** Declared here, the leaf of the anonymiser's modules, and re-exported by anonymize.ts. */
export type SnapshotPlatform = PlatformId;

/**
 * Accounts whose names carry meaning the tests rely on (platform-declared automation, the platform
 * itself) and which identify no person.
 */
export const SYSTEM_ACCOUNTS: ReadonlySet<string> = new Set([
  "automoderator",
  "reddit",
  "deleted",
  "removed",
]);
/** Top-level X paths that look like `/<handle>` but are not profiles. */
export const X_RESERVED_PATHS: ReadonlySet<string> = new Set([
  "home",
  "explore",
  "i",
  "search",
  "settings",
  "messages",
  "notifications",
  "compose",
  "hashtag",
  "login",
  "signup",
  "intent",
  "share",
  "about",
  "tos",
  "privacy",
  "jobs",
  "premium",
  "download",
]);
const REDDIT_GENERATED_NAME = /^[A-Z][a-z]+[-_][A-Z][a-z]+[-_]?\d{1,4}$/;

/** Character class that bounds a handle: a handle never contains these, so they mark its edges. */
const REDDIT_HANDLE = "[A-Za-z0-9_-]{1,20}";
const X_HANDLE = "[A-Za-z0-9_]{1,15}";
const BLUESKY_HANDLE = "[a-z0-9-]+(?:\\.[a-z0-9-]+)+";

function collect(html: string, pattern: RegExp): Set<string> {
  const found: Set<string> = new Set();
  for (const match of html.matchAll(pattern)) {
    const value: string | undefined = match[1];
    if (value !== undefined && isHandleLongEnough(value)) found.add(value);
  }
  return found;
}

export function handlesOf(html: string, platform: SnapshotPlatform): Set<string> {
  switch (platform) {
    case "reddit":
      return new Set([
        ...collect(html, new RegExp(`\\b(?:data-)?author="(${REDDIT_HANDLE})"`, "g")),
        ...collect(html, new RegExp(`/(?:user|u)/(${REDDIT_HANDLE})(?=[/"?#])`, "g")),
        ...collect(html, new RegExp(`aria-label="(${REDDIT_HANDLE})'s profile`, "g")),
      ]);
    case "x":
      return new Set(
        [
          ...collect(html, new RegExp(`href="/(${X_HANDLE})/status/`, "g")),
          ...collect(html, new RegExp(`href="/(${X_HANDLE})"`, "g")),
          ...collect(html, new RegExp(`(?:^|[^\\w])@(${X_HANDLE})\\b`, "g")),
        ].filter((handle) => !X_RESERVED_PATHS.has(handle.toLowerCase())),
      );
    case "bluesky":
      return new Set([
        ...collect(html, new RegExp(`/profile/(${BLUESKY_HANDLE})(?=[/"?#])`, "g")),
        ...collect(html, new RegExp(`(?:^|[^\\w.])@(${BLUESKY_HANDLE})\\b`, "g")),
      ]);
    case "hackernews":
      return hackerNewsHandles(html);
    case "youtube":
      return youTubeHandles(html);
  }
}

export function fakeFor(handle: string, platform: SnapshotPlatform, attempt = 0): string {
  if (platform === "youtube") return youTubeFakeHandle(handle, attempt);
  if (platform === "bluesky") {
    const base: string = fakeHandle(handle, "plain", attempt).replace("_", "");
    return handle.endsWith(".bsky.social") ? `${base}.bsky.social` : `${base}.example.com`;
  }
  if (platform === "reddit" && REDDIT_GENERATED_NAME.test(handle))
    return fakeHandle(handle, "generated", attempt);
  if (NAME_THEN_DIGITS.test(handle)) return fakeHandle(handle, "nameDigits", attempt);
  return fakeHandle(handle, "plain", attempt);
}

/** Hacker News usernames are case-sensitive; every other platform folds case. */
export function accountOf(platform: SnapshotPlatform): (handle: string) => string {
  return platform === "hackernews" ? (handle) => handle : (handle) => handle.toLowerCase();
}
