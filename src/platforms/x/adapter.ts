/**
 * The X platform adapter: the one object the pipeline and the wiring see. Selectors live in
 * dom.ts, the sources in sources/, the feature gates in features.ts; this file only assembles them.
 */
import { PageThreads } from "@/src/core/thread/pageThreads";
import type { PlatformAdapter } from "@/src/core/types";
import { extractDomSignals } from "./dom";
import { toFeatures } from "./features";
import { observeFeed } from "./observer";
import type { QueryIdRegistry } from "./queryIds";
import { createAboutAccountSource } from "./sources/aboutAccount";
import { createPassiveGraphqlSource } from "./sources/passiveGraphql";
import type { XReplyReader } from "./threadReply";
import { createXReplyReader, threadKeyOf } from "./threadReply";

export interface XAdapterOptions {
  registry: QueryIdRegistry;
  /** Called with the new URL when the page navigates in place; per-page state resets here. */
  onRouteChange?: (href: string) => void;
  target?: Window & typeof globalThis;
}

const X_HOSTNAME_PATTERN = /^(www\.|mobile\.)?(x|twitter)\.com$/;

export function createXAdapter(options: XAdapterOptions): PlatformAdapter {
  const target: Window & typeof globalThis = options.target ?? window;
  const replyReader: XReplyReader = createXReplyReader(target);
  // X's page shows links only as t.co: their targets come from Tier 1 bodies, by status id.
  const threads = new PageThreads(replyReader.read, 1);
  return {
    id: "x",
    matches: (url) => X_HOSTNAME_PATTERN.test(url.hostname),
    observeFeed: (onPost, onRemoved) =>
      observeFeed({
        onPost,
        onRemoved,
        root: target.document,
        onDiscovered: threads.discovered,
        onRouteChange: (href) => {
          replyReader.reset();
          threads.navigated();
          options.onRouteChange?.(href);
        },
      }),
    extractDomSignals,
    sources: [
      // The root's status id is the thread key the page's URL names; X changes the URL before
      // it fetches the conversation, so the body always arrives under the page it belongs to.
      createPassiveGraphqlSource(target, (statusId, links) =>
        statusId === threadKeyOf(new URL(target.location.href))
          ? threads.recordRootLinks(statusId, links)
          : threads.recordPostLinks(statusId, links),
      ),
      createAboutAccountSource({ registry: options.registry }),
    ],
    toFeatures: threads.withPageEvidence(toFeatures),
    onEvidenceChanged: threads.subscribe,
    badgeDensity: "x",
  };
}
