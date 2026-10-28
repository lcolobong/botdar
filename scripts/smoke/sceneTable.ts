/**
 * The smoke scene table: which platforms the fixture server stands in for, the real hostnames it
 * answers to, and the pages captured on each. Pure data, shared by the smoke and perf runners.
 */
export type SmokePlatformId = "x" | "reddit" | "bluesky" | "hackernews" | "youtube";

export const smokePlatformIds: readonly SmokePlatformId[] = [
  "x",
  "reddit",
  "bluesky",
  "hackernews",
  "youtube",
];

/** The hostnames the content scripts are allowed to run on; the server answers for all of them. */
export const smokeHostnames: Readonly<Record<SmokePlatformId, string>> = {
  x: "x.com",
  reddit: "www.reddit.com",
  bluesky: "bsky.app",
  hackernews: "news.ycombinator.com",
  youtube: "www.youtube.com",
};

/** The Hacker News Firebase API, which the content script reaches cross-origin. */
export const hackerNewsApiHostname = "hacker-news.firebaseio.com";

export interface SmokeFeedScene {
  readonly platform: SmokePlatformId;
  /** Names the capture; "feed" is each platform's primary scene and its hover capture is "hover". */
  readonly scene: string;
  /** A path the real site uses for this page, so routing in the content script sees a familiar URL. */
  readonly path: string;
  /** A specific recorded page under tests/fixtures/<platform>/html/; otherwise the preferred one. */
  readonly fixtureFile?: string;
  /** A page anywhere in the repository, relative to its root; wins over fixtureFile. */
  readonly fixturePath?: string;
  /** Carried into the manifest, for a scene that is expected to draw nothing. */
  readonly note?: string;
  /**
   * Hover the badge mounted after this element (a CSS selector for the adapter's badge anchor)
   * instead of the most interesting badge on the page.
   */
  readonly hoverAnchor?: string;
}

export const smokeFeedScenes: readonly SmokeFeedScene[] = [
  { platform: "x", scene: "feed", path: "/home" },
  // The recorded timeline again, at a profile path where its script also fetches maria_dev's
  // About lookup, profile timeline and replies tab (hand-written bodies under tests/fixtures/smoke/).
  {
    platform: "x",
    scene: "profile",
    path: "/maria_dev",
    fixtureFile: "timeline.html",
    hoverAnchor: 'div:has(> a[href="/maria_dev"])',
  },
  { platform: "reddit", scene: "feed", path: "/" },
  {
    platform: "reddit",
    scene: "comments",
    path: "/r/woodworking/comments/1k9x2ab/finished_the_walnut_side_table/",
    fixtureFile: "comments.html",
  },
  // A hand-written thread where two new accounts post near copies of an earlier comment; their
  // profiles are served below, so the hover card on the later copier shows a full read.
  {
    platform: "reddit",
    scene: "copied-replies",
    path: "/r/woodworking/comments/1k9x2ab/walnut_table_copied_replies/",
    fixtureFile: "copied-replies.html",
    hoverAnchor: 'a[href="/user/Bright_Sail_8803/"]',
  },
  // A hand-written link post whose comments link one small site from six accounts; the last of
  // them has a profile served below, so its hover card shows a full read.
  {
    platform: "reddit",
    scene: "shared-links",
    path: "/r/harbourcity/comments/1kb4c7d/council_votes_to_close_the_harbour_street_bridge/",
    fixtureFile: "shared-links.html",
    hoverAnchor: 'a[href="/user/Tidal_Quill_5530/"]',
  },
  { platform: "bluesky", scene: "feed", path: "/" },
  // The feed page again, at a profile path where its script also fetches alice.example.com's
  // author feed (a hand-written body under tests/fixtures/smoke/).
  {
    platform: "bluesky",
    scene: "profile",
    path: "/profile/alice.example.com",
    fixtureFile: "feed.html",
    hoverAnchor: 'a[href="/profile/alice.example.com"]',
  },
  { platform: "hackernews", scene: "thread", path: "/item", fixtureFile: "thread.html" },
  { platform: "hackernews", scene: "front", path: "/", fixtureFile: "front.html" },
  // The recorded watch page. YouTube looks a commenter up on hover only, so the feed capture shows
  // the page alone and the hover capture the recorded commenter's About panel.
  {
    platform: "youtube",
    scene: "watch",
    path: "/watch",
    fixtureFile: "watch.html",
    hoverAnchor: 'a#author-text[href="/@jonas_reads12"]',
  },
];
