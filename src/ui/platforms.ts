import type { PlatformId } from "@/src/core/types";

/** Display names in the order the pages list the platforms. */
export const PLATFORM_NAMES: Record<PlatformId, string> = {
  x: "X",
  reddit: "Reddit",
  bluesky: "Bluesky",
  hackernews: "Hacker News",
};

/** The hosts each toggle covers, as the options page captions them. */
export const PLATFORM_DOMAINS: Record<PlatformId, string> = {
  x: "x.com and twitter.com",
  reddit: "reddit.com and old.reddit.com",
  bluesky: "bsky.app",
  hackernews: "news.ycombinator.com",
};
