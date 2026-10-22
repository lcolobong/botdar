/**
 * The X platform adapter: the one object the pipeline and the wiring see. Selectors live in
 * dom.ts, the sources in sources/, the feature gates in features.ts; this file only assembles them.
 */
import type { PlatformAdapter } from "@/src/core/types";
import { extractDomSignals } from "./dom";
import { toFeatures } from "./features";
import { observeFeed } from "./observer";
import type { QueryIdRegistry } from "./queryIds";
import { createAboutAccountSource } from "./sources/aboutAccount";
import { createPassiveGraphqlSource } from "./sources/passiveGraphql";

export interface XAdapterOptions {
  registry: QueryIdRegistry;
  /** Called with the new URL when the page navigates in place; per-page state resets here. */
  onRouteChange?: (href: string) => void;
  target?: Window & typeof globalThis;
}

const X_HOSTNAME_PATTERN = /^(www\.|mobile\.)?(x|twitter)\.com$/;

export function createXAdapter(options: XAdapterOptions): PlatformAdapter {
  const target: Window & typeof globalThis = options.target ?? window;
  return {
    id: "x",
    matches: (url) => X_HOSTNAME_PATTERN.test(url.hostname),
    observeFeed: (onPost, onRemoved) =>
      observeFeed({
        onPost,
        onRemoved,
        root: target.document,
        ...(options.onRouteChange === undefined ? {} : { onRouteChange: options.onRouteChange }),
      }),
    extractDomSignals,
    sources: [
      createPassiveGraphqlSource(target),
      createAboutAccountSource({ registry: options.registry }),
    ],
    toFeatures: (signals) => toFeatures(signals),
    badgeDensity: "x",
  };
}
