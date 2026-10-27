/**
 * The Bluesky PlatformAdapter: Tier 0 from dom.ts, Tier 1 from the relayed XRPC bodies, Tier 2 from
 * the batched public getProfiles call and the per-author getAuthorFeed call, features from
 * features.ts, and the page's thread replies from threadReply.ts. A factory rather than a constant
 * because the passive source binds to the window it is created in.
 */
import { PageThreads } from "../../core/thread/pageThreads";
import type { PlatformAdapter } from "../../core/types";
import { extractDomSignals } from "./dom";
import { toFeatures } from "./features";
import { observeBlueskyFeed } from "./observer";
import { createGetAuthorFeedSource } from "./sources/getAuthorFeed";
import { createGetProfilesSource } from "./sources/getProfiles";
import { createPassiveXrpcSource } from "./sources/passiveXrpc";
import { threadReplyOf } from "./threadReply";

const BLUESKY_HOST = "bsky.app";

export function createBlueskyAdapter(): PlatformAdapter {
  const threads = new PageThreads((item) => threadReplyOf(item, new URL(window.location.href)));
  return {
    id: "bluesky",
    matches: (url: URL): boolean => url.hostname === BLUESKY_HOST,
    observeFeed: (onPost, onRemoved) =>
      observeBlueskyFeed({
        onPost,
        onRemoved,
        onDiscovered: threads.discovered,
        onRouteChange: threads.navigated,
      }),
    extractDomSignals,
    sources: [createPassiveXrpcSource(), createGetProfilesSource(), createGetAuthorFeedSource()],
    toFeatures: threads.withPageEvidence(toFeatures),
    onEvidenceChanged: threads.subscribe,
    badgeDensity: "bluesky",
  };
}
