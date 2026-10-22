/**
 * The Reddit PlatformAdapter (docs/architecture.md, "Reddit"): feed discovery and Tier 0 from dom.ts
 * and observer.ts, the about.json lookup as the only source (Reddit has no Tier 1 because its feeds
 * arrive as HTML partials), and the feature table from features.ts. Posts and comments share one
 * feed at two densities, so each PostRef carries its own density over the adapter default.
 */
import type { PlatformAdapter, PostRef, SignalSource } from "../../core/types";
import { densityFor, extractDomSignals } from "./dom";
import { toFeatures } from "./features";
import { observeRedditFeed } from "./observer";
import { aboutJsonSource } from "./sources/aboutJson";

export const REDDIT_HOSTS: ReadonlySet<string> = new Set(["www.reddit.com", "old.reddit.com"]);

export interface RedditAdapterOptions {
  sources?: SignalSource[];
  onRouteChange?: (href: string) => void;
}

export function matchesReddit(url: URL): boolean {
  return url.protocol === "https:" && REDDIT_HOSTS.has(url.hostname);
}

export function createRedditAdapter(options: RedditAdapterOptions = {}): PlatformAdapter {
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
        ...(options.onRouteChange === undefined ? {} : { onRouteChange: options.onRouteChange }),
      }),
    extractDomSignals,
    sources: options.sources ?? [aboutJsonSource],
    toFeatures: (signals) => toFeatures(signals),
    badgeDensity: "reddit-post",
  };
  return adapter;
}

export const redditAdapter: PlatformAdapter = createRedditAdapter();
