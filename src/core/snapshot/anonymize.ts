import {
  distinctDigits,
  distinctFakes,
  fakeDigits,
  fakeHandle,
  fakeId,
  stableHash,
} from "./fakeNames.ts";
import {
  anonymizeHackerNewsUrl,
  hackerNewsHandles,
  hackerNewsIdSubstitutions,
  replaceHackerNewsHandles,
} from "./hackerNews.ts";

export type SnapshotPlatform = "x" | "reddit" | "bluesky" | "hackernews";

export const SNAPSHOT_PLATFORMS: readonly SnapshotPlatform[] = [
  "x",
  "reddit",
  "bluesky",
  "hackernews",
];

export interface AnonymizedSnapshot {
  html: string;
  /** Distinct usernames, DIDs and ids that were replaced. */
  handles: number;
  /** Total substitutions made, every occurrence counted. */
  replaced: number;
}

/**
 * Accounts whose names carry meaning the tests rely on (platform-declared automation, the platform
 * itself) and which identify no person.
 */
const SYSTEM_ACCOUNTS: ReadonlySet<string> = new Set([
  "automoderator",
  "reddit",
  "deleted",
  "removed",
]);
/** Top-level X paths that look like `/<handle>` but are not profiles. */
const X_RESERVED_PATHS: ReadonlySet<string> = new Set([
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
const NAME_THEN_DIGITS = /^[A-Za-z]+\d{5,}$/;
const MIN_HANDLE_LENGTH = 3;

/** Character class that bounds a handle: a handle never contains these, so they mark its edges. */
const REDDIT_HANDLE = "[A-Za-z0-9_-]{1,20}";
const X_HANDLE = "[A-Za-z0-9_]{1,15}";
const BLUESKY_HANDLE = "[a-z0-9-]+(?:\\.[a-z0-9-]+)+";

function collect(html: string, pattern: RegExp): Set<string> {
  const found: Set<string> = new Set();
  for (const match of html.matchAll(pattern)) {
    const value: string | undefined = match[1];
    if (value !== undefined && value.length >= MIN_HANDLE_LENGTH) found.add(value);
  }
  return found;
}

function handlesOf(html: string, platform: SnapshotPlatform): Set<string> {
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
  }
}

function fakeFor(handle: string, platform: SnapshotPlatform, attempt = 0): string {
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
function accountOf(platform: SnapshotPlatform): (handle: string) => string {
  return platform === "hackernews" ? (handle) => handle : (handle) => handle.toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Substitution {
  pattern: RegExp;
  replacement: (match: string, ...groups: string[]) => string;
}

/**
 * Opaque ids per platform: thing ids and permalink ids, status ids, DIDs, record keys and Hacker
 * News item ids. `fakeNumeric` replaces the numeric ones (X status ids, item ids); when
 * anonymising a page it is distinct per snapshot.
 */
function idSubstitutions(
  platform: SnapshotPlatform,
  fakeNumeric: (id: string) => string = fakeDigits,
): Substitution[] {
  switch (platform) {
    case "reddit":
      return [
        {
          pattern: /\bt([1-6])_([a-z0-9]{4,})\b/g,
          replacement: (_m, kind, id) => `t${kind}_${fakeId(id)}`,
        },
        {
          pattern: /\/comments\/([a-z0-9]{5,8})(?=\/)/g,
          replacement: (_m, id) => `/comments/${fakeId(id)}`,
        },
      ];
    case "x":
      return [
        {
          pattern: /\/status\/(\d{15,20})\b/g,
          replacement: (_m, id) => `/status/${fakeNumeric(id)}`,
        },
      ];
    case "bluesky":
      return [
        { pattern: /did:plc:([a-z0-9]{24})\b/g, replacement: (_m, id) => `did:plc:${fakeId(id)}` },
        { pattern: /\/post\/([a-z0-9]{13})\b/g, replacement: (_m, id) => `/post/${fakeId(id)}` },
      ];
    case "hackernews":
      return hackerNewsIdSubstitutions(fakeNumeric);
  }
}

/**
 * Uploaded avatars identify a person as surely as a name. The path after the platform's avatar
 * marker is hashed, which keeps the marker the adapters read to tell a stock avatar from an
 * uploaded one (`default_profile_images`, `redditstatic.com/avatars/defaults`) untouched.
 */
const AVATAR_SUBSTITUTIONS: Substitution[] = [
  {
    pattern: /(profileIcon_)[A-Za-z0-9_-]+(\.[a-z]+)/g,
    replacement: (_m, prefix, ext) => `${prefix}anon${ext}`,
  },
  {
    pattern: /(\/profile_images\/)\d+\/[^"'\s?]+/g,
    replacement: (_m, prefix) => `${prefix}0/anon_normal.jpg`,
  },
  {
    pattern: /(\/img\/avatar(?:_thumbnail)?\/plain\/)[^"'\s]+/g,
    replacement: (_m, prefix) => `${prefix}anon@jpeg`,
  },
  { pattern: /(styles\.redditmedia\.com\/[^"'\s]*?)\?[^"'\s]*/g, replacement: (_m, path) => path },
];

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
  if (platform === "hackernews") {
    const matched: Set<string> = new Set();
    output = replaceHackerNewsHandles(output, fakes, (handle) => {
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
 * occurrences were. The HTML patterns above do not match a bare URL, so a profile or status
 * address is handled by path segment here; the query and fragment are dropped.
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
