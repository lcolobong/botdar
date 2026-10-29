/**
 * YouTube anonymisation, kept apart from anonymize.ts because YouTube names accounts differently
 * from the other platforms. A commenter is named only by an `@handle` (the watch page shows no
 * display name in a comment), handles may be written in any script ("@Ασσουρμπανιπάλ-ψ9χ") and are
 * percent-encoded in links, and a mention links the channel's `UC…` id instead. Handles are therefore
 * replaced only where the "@" marks them, so a handle that is also an ordinary word ("@news") never
 * rewrites prose. Video and comment ids, channel ids, avatar paths and the session values the
 * innertube bodies carry are replaced too; display names and comment text are prose and stay.
 */
import { NAME_THEN_DIGITS, fakeHandle, fakeId, stableHash } from "./fakeNames.ts";
import {
  USER_PREFIX,
  isAssignedCodeHandle,
  isHandleLongEnough,
  isUserPrefixedHandle,
} from "../handleRules.ts";

const LOWERCASE_A = 97;

/** A handle character other than the full stop, which a handle never ends with but a sentence does. */
const HANDLE_WORD_CHAR = String.raw`[\p{L}\p{N}\p{M}_\-]`;
const HANDLE_CHAR = String.raw`(?:${HANDLE_WORD_CHAR}|\.)`;
const ENCODED_BYTE = "%[0-9A-Fa-f]{2}";
/** What may follow a handle: not another handle character, except a full stop that ends a sentence. */
const HANDLE_END = String.raw`(?!${HANDLE_WORD_CHAR}|\.${HANDLE_WORD_CHAR})`;
/** A handle in a path (`/@name`, percent-encoded outside ASCII) or an author button's label. */
const HANDLE_SOURCES: readonly RegExp[] = [
  new RegExp(
    `/@((?:${ENCODED_BYTE}|${HANDLE_CHAR})*(?:${ENCODED_BYTE}|${HANDLE_WORD_CHAR}))${HANDLE_END}`,
    "gu",
  ),
  new RegExp(`aria-label="@(${HANDLE_CHAR}*${HANDLE_WORD_CHAR})${HANDLE_END}`, "gu"),
];
/** The handle YouTube assigns a channel that never chose one: its name, "-" and a short code. */
const ASSIGNED_SUFFIX = /^(.+)-([\p{Ll}\p{N}]{3,5})$/u;

function decoded(handle: string): string {
  try {
    return decodeURIComponent(handle);
  } catch {
    return handle;
  }
}

/** The handles the page names accounts by, decoded. */
export function youTubeHandles(text: string): Set<string> {
  const handles: Set<string> = new Set();
  for (const pattern of HANDLE_SOURCES) {
    for (const match of text.matchAll(pattern)) {
      const handle: string = decoded(match[1] ?? "");
      if (isHandleLongEnough(handle)) handles.add(handle);
    }
  }
  return handles;
}

/** Each letter of `code` becomes a letter and each digit a digit, so an assigned code stays one. */
function fakeCode(code: string, seed: string): string {
  return [...code]
    .map((char, index) => {
      const hash: number = stableHash(`${seed}:${index}`);
      return /\p{N}/u.test(char)
        ? String(hash % 10)
        : String.fromCharCode(LOWERCASE_A + (hash % 26));
    })
    .join("");
}

/**
 * A fake that keeps the shape the YouTube features read: an assigned handle ("Name-x7k",
 * "user-abc12345xy") stays assigned-looking, a name with many digits keeps its digit run, and
 * anything else becomes an ordinary word pair.
 */
export function youTubeFakeHandle(handle: string, attempt: number): string {
  const lowercase: string = handle.toLowerCase();
  const seed: string = attempt === 0 ? lowercase : `${lowercase}#${attempt}`;
  if (isUserPrefixedHandle(handle)) {
    return `${USER_PREFIX}${fakeId(seed, lowercase.length - USER_PREFIX.length)}`;
  }
  const assigned: RegExpExecArray | null = isAssignedCodeHandle(handle)
    ? ASSIGNED_SUFFIX.exec(lowercase)
    : null;
  if (assigned !== null) {
    return `${fakeHandle(assigned[1] ?? "", "plain", attempt)}-${fakeCode(assigned[2] ?? "", seed)}`;
  }
  return fakeHandle(handle, NAME_THEN_DIGITS.test(handle) ? "nameDigits" : "plain", attempt);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces every "@handle" (and its percent-encoded spelling in links) with its fake, matching case
 * insensitively as YouTube does; reports each replacement by the decoded handle.
 */
export function replaceYouTubeHandles(
  text: string,
  fakes: ReadonlyMap<string, string>,
  onReplace: (handle: string) => void,
): string {
  if (fakes.size === 0) return text;
  const fakeBySpelling: Map<string, { handle: string; fake: string }> = new Map();
  for (const [handle, fake] of fakes) {
    for (const spelling of [handle, encodeURIComponent(handle)]) {
      fakeBySpelling.set(spelling.toLowerCase(), { handle, fake });
    }
  }
  const alternation: string = [...fakeBySpelling.keys()]
    .sort((first, second) => second.length - first.length)
    .map(escapeRegExp)
    .join("|");
  return text.replace(new RegExp(`@(${alternation})${HANDLE_END}`, "giu"), (match, spelling) => {
    const known = fakeBySpelling.get(String(spelling).toLowerCase());
    if (known === undefined) return match;
    onReplace(known.handle);
    return `@${known.fake}`;
  });
}

export interface YouTubeSubstitution {
  pattern: RegExp;
  replacement: (match: string, ...groups: string[]) => string;
}

/**
 * Channel ids, video ids, comment ids (a reply's id is its thread's id, a full stop and its own
 * part, so each part is replaced on its own and a reply keeps pointing at its thread), the session
 * values innertube bodies carry, and the redirect tokens of outbound links.
 */
export const YOUTUBE_ID_SUBSTITUTIONS: readonly YouTubeSubstitution[] = [
  {
    pattern: /(?<![\w-])UC([\w-]{22})(?![\w-])/g,
    replacement: (_match, id) => `UC${fakeId(id, 22)}`,
  },
  {
    pattern: /(?<=lc=|"commentId":")(Ug[\w-]{20,})(?:\.([\w-]+))?/g,
    replacement: (_match, thread, reply) =>
      `Ug${fakeId(thread, thread.length - 2)}${reply === undefined ? "" : `.${fakeId(reply)}`}`,
  },
  {
    pattern:
      /("(?:visitorData|serializedShareEntity|trackingParams|clickTrackingParams|token|continuation)":")[^"]*/g,
    replacement: (_match, key) => `${key}anon`,
  },
  { pattern: /(redir_token=)[^&"]+/g, replacement: (_match, key) => `${key}anon` },
];

/** Where the page names a video: links, thumbnails, the player's and the lockups' attributes. */
const VIDEO_ID_SOURCE =
  /(?:[?&;]v=|\/vi(?:_webp)?\/|\/shorts\/|\/embed\/|"videoId":"|video-id="|content-id-)([\w-]{11})(?![\w-])/g;

/**
 * Video ids, found where the page names a video and then replaced wherever they occur, since the
 * page also repeats them percent-encoded in sign-in links and in microdata. Returns the new text
 * and how many replacements were made.
 */
export function replaceYouTubeVideoIds(text: string): { text: string; replaced: number } {
  const ids: Set<string> = new Set(
    [...text.matchAll(VIDEO_ID_SOURCE)].map((match) => match[1] ?? ""),
  );
  ids.delete("");
  if (ids.size === 0) return { text, replaced: 0 };
  let replaced = 0;
  const alternation: string = [...ids].map(escapeRegExp).join("|");
  // An id ends a percent-encoded "v=" (%3D, %253D) or a "content-id-" class as well as a word.
  const start = "(?:(?<![\\w-])|(?<=%3D|%253D|content-id-))";
  const output: string = text.replace(
    new RegExp(`${start}(?:${alternation})(?![\\w-])`, "g"),
    (id) => {
      replaced += 1;
      return fakeId(id, 11);
    },
  );
  return { text: output, replaced };
}

/** Avatar and banner paths, keeping the `ytc/` marker of an avatar the account did not upload. */
export const YOUTUBE_AVATAR_SUBSTITUTION: YouTubeSubstitution = {
  pattern: /(yt3\.(?:ggpht|googleusercontent)\.com\/(?:ytc\/)?)[\w-]+/g,
  replacement: (_match, prefix) => `${prefix}anon`,
};

/** A recorded address: the watch page keeps its `v` parameter, faked; a channel path its handle. */
export function anonymizeYouTubeUrl(parsed: URL): string {
  const path: string = parsed.pathname.replace(/^\/@([^/]+)/, (_match, handle: string) => {
    return `/@${youTubeFakeHandle(decoded(handle), 0)}`;
  });
  const video: string | null = parsed.searchParams.get("v");
  return `${parsed.origin}${path}${video === null ? "" : `?v=${fakeId(video, 11)}`}`;
}
