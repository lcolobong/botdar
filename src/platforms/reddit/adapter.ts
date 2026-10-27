/**
 * The Reddit PlatformAdapter (docs/architecture.md, "Reddit"): feed discovery and Tier 0 from dom.ts
 * and observer.ts, the Tier 2 lookups as the only sources (about.json on sight, overview.json on
 * hover; Reddit has no Tier 1 because its feeds arrive as HTML partials), and the feature table from
 * features.ts. Posts and comments share one feed at two densities, so each PostRef carries its own
 * density over the adapter default.
 */
import { PageThreads } from "../../core/thread/pageThreads";
import type { PlatformAdapter, PostRef, SignalSource } from "../../core/types";
import type { OnSightPlatform } from "../onSightWire";
import { densityFor, extractDomSignals } from "./dom";
import { toFeatures } from "./features";
import { observeRedditFeed } from "./observer";
import { aboutJsonSource } from "./sources/aboutJson";
import { threadReplyOf, threadRootLinksOf } from "./threadReply";
import { overviewJsonSource } from "./sources/overviewJson";

export const REDDIT_HOSTS: ReadonlySet<string> = new Set(["www.reddit.com", "old.reddit.com"]);

export interface RedditAdapterOptions {
  sources?: SignalSource[];
  onRouteChange?: (href: string) => void;
}

export function matchesReddit(url: URL): boolean {
  return url.protocol === "https:" && REDDIT_HOSTS.has(url.hostname);
}

export function createRedditAdapter(options: RedditAdapterOptions = {}): PlatformAdapter {
  const threads = new PageThreads(
    (element) =>
      threadReplyOf(element) ?? threadRootLinksOf(element, new URL(window.location.href)),
  );
  const adapter: PlatformAdapter = {
    id: "reddit",
    matches: matchesReddit,
    observeFeed: (onPost, onRemoved) =>
      observeRedditFeed({
        onPost: (post) => {
          const withDensity: PostRef = { ...post, density: densityFor(post.kind) };
          onPost(withDensity);
        },
        onRemoved,
        onDiscovered: threads.discovered,
        onRouteChange: (href) => {
          threads.navigated();
          options.onRouteChange?.(href);
        },
      }),
    extractDomSignals,
    sources: options.sources ?? [aboutJsonSource, overviewJsonSource],
    toFeatures: threads.withPageEvidence(toFeatures),
    onEvidenceChanged: threads.subscribe,
    badgeDensity: "reddit-post",
  };
  return adapter;
}

export const redditAdapter: PlatformAdapter = createRedditAdapter();

/** Reddit as the shared on-sight wiring sees it (src/platforms/onSightWire.ts). */
export const redditOnSight: OnSightPlatform = {
  platform: "reddit",
  adapter: redditAdapter,
  cardHandle: (handle) => `u/${handle}`,
};
