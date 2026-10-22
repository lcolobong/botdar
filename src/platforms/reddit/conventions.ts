/**
 * Reddit conventions shared by the Tier 0 DOM reader and the Tier 2 about.json parser: what a
 * username looks like and which avatar URLs are Reddit's stock defaults.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

/**
 * Reddit's stock avatars live under redditstatic.com as `avatars/defaults/v2/avatar_default_N.png`
 * (current) or `avatars/avatar_default_NN_HEX.png` (older). Uploaded avatars and snoovatars are served
 * from redditmedia.com or i.redd.it and never match.
 */
const DEFAULT_AVATAR_PATTERN = /redditstatic\.com\/avatars\/(?:defaults\/|avatar_default_)/i;

/** Rejects "[deleted]", empty strings and anything else Reddit would not accept as a username. */
export function isPlausibleUsername(name: string): boolean {
  return USERNAME_PATTERN.test(name);
}

export function isDefaultAvatarUrl(url: string): boolean {
  return DEFAULT_AVATAR_PATTERN.test(url);
}
