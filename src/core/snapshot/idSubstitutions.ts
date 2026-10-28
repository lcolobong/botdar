/**
 * The opaque ids and avatar paths a serialized page carries per platform, as pattern and
 * replacement pairs the anonymiser applies after the handles.
 */
import { fakeDigits, fakeId } from "./fakeNames.ts";
import { hackerNewsIdSubstitutions } from "./hackerNews.ts";
import { YOUTUBE_AVATAR_SUBSTITUTION, YOUTUBE_ID_SUBSTITUTIONS } from "./youTube.ts";
import type { SnapshotPlatform } from "./accountHandles.ts";

export interface Substitution {
  pattern: RegExp;
  replacement: (match: string, ...groups: string[]) => string;
}

/**
 * Opaque ids per platform: thing ids and permalink ids, status ids, DIDs, record keys and Hacker
 * News item ids. `fakeNumeric` replaces the numeric ones (X status ids, item ids); when
 * anonymising a page it is distinct per snapshot.
 */
export function idSubstitutions(
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
    case "youtube":
      return [...YOUTUBE_ID_SUBSTITUTIONS];
  }
}

/**
 * Uploaded avatars identify a person as surely as a name. The path after the platform's avatar
 * marker is hashed, which keeps the marker the adapters read to tell a stock avatar from an
 * uploaded one (`default_profile_images`, `redditstatic.com/avatars/defaults`) untouched.
 */
export const AVATAR_SUBSTITUTIONS: Substitution[] = [
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
  YOUTUBE_AVATAR_SUBSTITUTION,
];
