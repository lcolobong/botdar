/**
 * The YouTube PlatformAdapter (docs/architecture.md, "YouTube", ADR-0030): comment discovery and
 * Tier 0 from dom.ts and observer.ts, the channel About lookup through innertube as the only source,
 * made on hover (no Tier 1: nothing the page fetches for itself is read), and the feature table from
 * features.ts. It keeps the page around the comments: the video's creator, which the imitation
 * feature compares names with, each comment thread's order, and the thread index, all reset when the
 * app moves to another page. The creator and the description are read on each discovery pass only
 * until they are found.
 */
import { PageThreads } from "../../core/thread/pageThreads";
import type { ThreadRootLinks } from "../../core/thread/replyText";
import type { PlatformAdapter, SignalSource } from "../../core/types";
import type { OnSightPlatform } from "../onSightWire";
import { YOUTUBE_ORIGIN } from "./conventions";
import type { YouTubeComment } from "./dom";
import { extractDomSignals, readVideoCreator } from "./dom";
import { toFeatures } from "./features";
import type { VideoCreator } from "./handles";
import { observeYouTubeComments } from "./observer";
import { channelAboutSource } from "./sources/channelAbout";
import { ThreadOrdinals, threadReplyOf, threadRootLinksOf } from "./threadReply";

export interface YouTubeAdapterOptions {
  sources?: SignalSource[];
}

export function matchesYouTube(url: URL): boolean {
  return url.origin === YOUTUBE_ORIGIN;
}

export function createYouTubeAdapter(options: YouTubeAdapterOptions = {}): PlatformAdapter {
  const pageUrl = (): URL => new URL(window.location.href);
  let ordinals = new ThreadOrdinals();
  /** Comment authors carrying the creator chip, who are the creator whatever the owner link says. */
  const chipHandles = new Set<string>();
  let creator: VideoCreator | undefined;
  let rootLinksRecordedFor: string | undefined;
  // Each comment is dated when it is read (threadReply.ts), not when the page was entered.
  const threads = new PageThreads((element) => threadReplyOf(element, pageUrl(), ordinals));

  const readPage = (): void => {
    creator ??= readVideoCreator(document, chipHandles);
    if (rootLinksRecordedFor !== undefined) return;
    const root: ThreadRootLinks | undefined = threadRootLinksOf(document, pageUrl());
    // The description renders before the comments; until it shows a link it is read again.
    if (root !== undefined && root.links.length > 0) {
      threads.recordRootLinks(root.threadKey, root.links);
      rootLinksRecordedFor = root.threadKey;
    }
  };

  const discovered = (element: Element, classified: YouTubeComment): void => {
    if (classified.status === "comment" && classified.post.byCreator) {
      const handle: string = classified.post.ref.handle;
      chipHandles.add(handle);
      if (creator !== undefined && !creator.handles.has(handle)) {
        creator = { ...creator, handles: new Set([...creator.handles, handle]) };
      }
    }
    threads.discovered(element, () => threadReplyOf(element, pageUrl(), ordinals, classified));
  };

  const navigated = (): void => {
    ordinals = new ThreadOrdinals();
    chipHandles.clear();
    creator = undefined;
    rootLinksRecordedFor = undefined;
    threads.navigated();
  };

  return {
    id: "youtube",
    matches: matchesYouTube,
    observeFeed: (onPost, onRemoved) =>
      observeYouTubeComments({
        onPost,
        onRemoved,
        onDiscovered: discovered,
        onPass: readPage,
        onNavigated: navigated,
      }),
    extractDomSignals,
    sources: options.sources ?? [channelAboutSource],
    toFeatures: threads.withPageEvidence((signals) => toFeatures(signals, creator)),
    onEvidenceChanged: threads.subscribe,
    badgeDensity: "youtube",
  };
}

export const youTubeAdapter: PlatformAdapter = createYouTubeAdapter();

/** YouTube as the shared wiring sees it: looked up on hover, named by its handle as the page does. */
export const youTubeOnHover: OnSightPlatform = {
  platform: "youtube",
  adapter: youTubeAdapter,
  cardHandle: (handle) => `@${handle}`,
  lookups: "onHover",
};
