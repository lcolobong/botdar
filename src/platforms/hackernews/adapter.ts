/**
 * The Hacker News PlatformAdapter (docs/architecture.md, "Hacker News", ADR-0026): feed discovery
 * and Tier 0 from dom.ts and observer.ts, the Firebase user lookup as the only source (the pages
 * are server-rendered, so there is no response of the page's own to read: no Tier 1), and the
 * feature table from features.ts. Stories and comments share one compact density.
 */
import type { PlatformAdapter, SignalSource } from "../../core/types";
import type { OnSightPlatform } from "../onSightWire";
import { extractDomSignals } from "./dom";
import { toFeatures } from "./features";
import { observeHackerNewsFeed } from "./observer";
import { firebaseUserSource } from "./sources/firebaseUser";

export const HACKER_NEWS_HOST = "news.ycombinator.com";

export interface HackerNewsAdapterOptions {
  sources?: SignalSource[];
}

export function matchesHackerNews(url: URL): boolean {
  return url.protocol === "https:" && url.hostname === HACKER_NEWS_HOST;
}

export function createHackerNewsAdapter(options: HackerNewsAdapterOptions = {}): PlatformAdapter {
  return {
    id: "hackernews",
    matches: matchesHackerNews,
    observeFeed: (onPost, onRemoved) => observeHackerNewsFeed({ onPost, onRemoved }),
    extractDomSignals,
    sources: options.sources ?? [firebaseUserSource],
    toFeatures: (signals) => toFeatures(signals),
    badgeDensity: "hackernews",
  };
}

export const hackerNewsAdapter: PlatformAdapter = createHackerNewsAdapter();

/** Hacker News as the shared on-sight wiring sees it; the card names the account as the site does. */
export const hackerNewsOnSight: OnSightPlatform = {
  platform: "hackernews",
  adapter: hackerNewsAdapter,
  cardHandle: (handle) => handle,
};
