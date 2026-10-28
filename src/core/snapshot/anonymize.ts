/**
 * The rewriting engine that anonymises a recorded page or its address. Which strings name an
 * account is in accountHandles.ts, and the id and avatar patterns are in idSubstitutions.ts.
 */
import { distinctDigits, distinctFakes, fakeDigits, fakeId, stableHash } from "./fakeNames.ts";
import {
  accountOf,
  fakeFor,
  handlesOf,
  SYSTEM_ACCOUNTS,
  X_RESERVED_PATHS,
} from "./accountHandles.ts";
import { anonymizeHackerNewsUrl, replaceHackerNewsHandles } from "./hackerNews.ts";
import type { Substitution } from "./idSubstitutions.ts";
import { AVATAR_SUBSTITUTIONS, idSubstitutions } from "./idSubstitutions.ts";
import type { SnapshotPlatform } from "./accountHandles.ts";
import { anonymizeYouTubeUrl, replaceYouTubeHandles, replaceYouTubeVideoIds } from "./youTube.ts";

import { PLATFORM_IDS } from "../types.ts";

export type { SnapshotPlatform } from "./accountHandles.ts";

export const SNAPSHOT_PLATFORMS: readonly SnapshotPlatform[] = PLATFORM_IDS;

export interface AnonymizedSnapshot {
  html: string;
  /** Distinct usernames, DIDs and ids that were replaced. */
  handles: number;
  /** Total substitutions made, every occurrence counted. */
  replaced: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces every username, DID, avatar path and opaque id in a serialized page with a stable fake,
 * so the same account maps to the same fake across recordings and tests can name it. Display names
 * and post text are left alone: they are prose, not identifiers, and the reviewer reads the fixture
 * before it is committed.
 */
export function anonymizeSnapshot(html: string, platform: SnapshotPlatform): AnonymizedSnapshot {
  let output: string = html;
  let replaced = 0;
  let handles = 0;
  const substitute = (pattern: RegExp, replacement: Substitution["replacement"]): void => {
    output = output.replace(pattern, (...args: unknown[]) => {
      replaced += 1;
      return replacement(...(args as [string, ...string[]]));
    });
  };

  const accounts: string[] = [...handlesOf(output, platform)].filter(
    (handle) => !SYSTEM_ACCOUNTS.has(handle.toLowerCase()),
  );
  const fakes: Map<string, string> = distinctFakes(
    accounts,
    (handle, attempt) => fakeFor(handle, platform, attempt),
    accountOf(platform),
  );
  if (platform === "hackernews" || platform === "youtube") {
    // Both replace a handle only where the page marks it as one, never page-wide.
    const replaceHandles: typeof replaceHackerNewsHandles =
      platform === "hackernews" ? replaceHackerNewsHandles : replaceYouTubeHandles;
    const matched: Set<string> = new Set();
    output = replaceHandles(output, fakes, (handle) => {
      matched.add(handle);
      replaced += 1;
    });
    handles += matched.size;
  } else if (fakes.size > 0) {
    // One pass for every handle: the content script runs this on a page that can be many
    // megabytes, and a scan per handle froze the tab. Longest first inside the alternation so a
    // handle that is a prefix of another never claims the other's occurrences; a hyphen is left
    // out of the Bluesky boundary on purpose, because the app's test ids read
    // `feedItem-by-<handle>` and the handle must still be replaced there.
    const boundary: string = platform === "bluesky" ? "[a-z0-9.]" : "[A-Za-z0-9_-]";
    const alternation: string = [...fakes.keys()]
      .sort((first, second) => second.length - first.length)
      .map(escapeRegExp)
      .join("|");
    const fakeByLowercase: Map<string, string> = new Map(
      [...fakes].map(([handle, fake]) => [handle.toLowerCase(), fake]),
    );
    const matched: Set<string> = new Set();
    substitute(new RegExp(`(?<!${boundary})(?:${alternation})(?!${boundary})`, "gi"), (match) => {
      const key: string = match.toLowerCase();
      matched.add(key);
      return fakeByLowercase.get(key) ?? match;
    });
    handles += matched.size;
  }
  const seenIds: Set<string> = new Set();
  for (const { pattern, replacement } of idSubstitutions(platform, distinctDigits())) {
    substitute(pattern, (match, ...groups) => {
      seenIds.add(match);
      return replacement(match, ...groups);
    });
  }
  handles += seenIds.size;
  if (platform === "youtube") {
    const videos: { text: string; replaced: number } = replaceYouTubeVideoIds(output);
    output = videos.text;
    replaced += videos.replaced;
  }
  for (const { pattern, replacement } of AVATAR_SUBSTITUTIONS) substitute(pattern, replacement);
  return { html: output, handles, replaced };
}

/** The provenance sentence a fixture header carries, for a recording or a raw export. */
export function describeAnonymization(anonymized: AnonymizedSnapshot | undefined): string {
  if (anonymized === undefined) {
    return "NOT anonymised: real usernames are in this file; do not commit it.";
  }
  return (
    `Usernames, ids and avatar paths are anonymised (${anonymized.handles} identifiers, ` +
    `${anonymized.replaced} substitutions); display names and post text are not, so read ` +
    "the file before committing it."
  );
}

/**
 * The address a recording came from, with the account it names replaced the way the page's
 * occurrences were. The HTML patterns in accountHandles.ts do not match a bare URL, so a profile
 * or status address is handled by path segment here; the query and fragment are dropped.
 */
export function anonymizeUrl(url: string, platform: SnapshotPlatform): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const segments: string[] = parsed.pathname.split("/");
  const replaceAt = (index: number): void => {
    const segment: string | undefined = segments[index];
    if (segment === undefined || segment === "" || SYSTEM_ACCOUNTS.has(segment.toLowerCase()))
      return;
    segments[index] = /^did:plc:[a-z0-9]{24}$/.test(segment)
      ? `did:plc:${fakeId(segment.slice(8))}`
      : fakeFor(segment, platform);
  };
  switch (platform) {
    case "reddit":
      if (segments[1] === "user" || segments[1] === "u") replaceAt(2);
      break;
    case "x":
      if (segments[1] !== undefined && !X_RESERVED_PATHS.has(segments[1].toLowerCase()))
        replaceAt(1);
      break;
    case "bluesky":
      if (segments[1] === "profile") replaceAt(2);
      break;
    case "hackernews":
      return anonymizeHackerNewsUrl(parsed, (id) => fakeFor(id, platform), fakeDigits);
    case "youtube":
      return anonymizeYouTubeUrl(parsed);
  }
  let path: string = segments.join("/");
  for (const { pattern, replacement } of idSubstitutions(platform)) {
    path = path.replace(pattern, (...args: unknown[]) =>
      replacement(...(args as [string, ...string[]])),
    );
  }
  return `${parsed.origin}${path}`;
}

/**
 * Exposed for the capture script's header: which fake a real handle became, without re-scanning.
 * A handle that collided with another on its page got a later attempt there instead.
 */
export function fakeHandleFor(handle: string, platform: SnapshotPlatform): string {
  return fakeFor(handle, platform);
}

export { stableHash };
