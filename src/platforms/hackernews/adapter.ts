/**
 * The Hacker News PlatformAdapter (docs/architecture.md, "Hacker News", ADR-0026): feed discovery
 * and Tier 0 from dom.ts and observer.ts, the Firebase user lookup as the only source (the pages
 * are server-rendered, so there is no response of the page's own to read: no Tier 1), and the
 * feature table from features.ts. Stories and comments share one compact density.
 */
import { PageThreads } from "../../core/thread/pageThreads";
import type { PlatformAdapter, SignalSource } from "../../core/types";
import type { OnSightPlatform } from "../onSightWire";
import { extractDomSignals } from "./dom";
import { toFeatures } from "./features";
import { observeHackerNewsFeed } from "./observer";
import { firebaseUserSource } from "./sources/firebaseUser";
import { threadReplyOf } from "./threadReply";

export const HACKER_NEWS_HOST = "news.ycombinator.com";

export interface HackerNewsAdapterOptions {
  sources?: SignalSource[];
}

export function matchesHackerNews(url: URL): boolean {
  return url.protocol === "https:" && url.hostname === HACKER_NEWS_HOST;
}

/** Navigation is a full page load, so the thread index never needs clearing in place. */
export function createHackerNewsAdapter(options: HackerNewsAdapterOptions = {}): PlatformAdapter {
  const threads = new PageThreads((row) => threadReplyOf(row, new URL(window.location.href)));
  return {
    id: "hackernews",
    matches: matchesHackerNews,
    observeFeed: (onPost, onRemoved) =>
      observeHackerNewsFeed({
        onPost,
        onRemoved,
        onDiscovered: (row, classified) =>
          threads.discovered(row, () =>
            threadReplyOf(row, new URL(window.location.href), classified),
          ),
      }),
    extractDomSignals,
    sources: options.sources ?? [firebaseUserSource],
    toFeatures: threads.withPageEvidence(toFeatures),
    onEvidenceChanged: threads.subscribe,
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
