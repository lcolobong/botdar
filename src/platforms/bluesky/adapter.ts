/**
 * The Bluesky PlatformAdapter: Tier 0 from dom.ts, Tier 1 from the relayed XRPC bodies, Tier 2 from
 * the batched public getProfiles call, features from features.ts. A factory rather than a constant
 * because the passive source binds to the window it is created in.
 */
import type { PlatformAdapter } from "../../core/types";
import { extractDomSignals } from "./dom";
import { toFeatures } from "./features";
import { observeBlueskyFeed } from "./observer";
import { createGetProfilesSource } from "./sources/getProfiles";
import { createPassiveXrpcSource } from "./sources/passiveXrpc";

const BLUESKY_HOST = "bsky.app";

export function createBlueskyAdapter(): PlatformAdapter {
  return {
    id: "bluesky",
    matches: (url: URL): boolean => url.hostname === BLUESKY_HOST,
    observeFeed: (onPost, onRemoved) => observeBlueskyFeed({ onPost, onRemoved }),
    extractDomSignals,
    sources: [createPassiveXrpcSource(), createGetProfilesSource()],
    toFeatures: (signals) => toFeatures(signals),
    badgeDensity: "bluesky",
  };
}
