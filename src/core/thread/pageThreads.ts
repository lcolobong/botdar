/**
 * A platform adapter's view of the page's thread indexes (ADR-0027, ADR-0029): the observer hands it
 * every post it discovers, before the post comes near the viewport, so a reply is compared with the
 * whole thread the page holds and not only the part already scrolled past. A platform supplies the
 * reader that turns one of its post elements into a reply (or its thread's root, read for its
 * links); everything else is the same on every platform.
 */
import { rareDomainsOf } from "../links/topDomains";
import { nearDuplicateReplyFeatures, sharedRareDomainFeatures } from "../scoring/featureSupport";
import type { AccountSignals, Feature, SourceTier } from "../types";
import type { AuthorsChangedListener } from "./answeredCounts";
import type { ThreadPostReading } from "./replyText";
import { NOT_YET_READABLE, isThreadRoot } from "./replyText";
import { SharedDomainIndex } from "./sharedDomainIndex";
import { ThreadIndex, placementOf } from "./threadIndex";

export type ThreadPostReader = (element: Element) => ThreadPostReading;

export class PageThreads {
  private readonly replies = new ThreadIndex();
  private readonly linkedDomains = new SharedDomainIndex();
  /**
   * Elements already read to a final answer, a reply or not one, so a discovery pass that meets them
   * again (X and Bluesky rescan every post on each pass) makes no DOM read.
   */
  private settledElements = new WeakSet<Element>();

  /**
   * `linkTier` is the tier that resolves the links the shared rare domain feature reads: 0 where the
   * page shows them, 1 on X, whose links come from its API responses (`recordPostLinks`).
   */
  constructor(
    private readonly readPost: ThreadPostReader,
    private readonly linkTier: SourceTier = 0,
  ) {}

  /**
   * The observer's discovery hook. Only an element whose markup has not finished rendering is read
   * again on a later pass. `read` overrides the reader for a platform whose observer already holds
   * part of the answer (Hacker News passes the row's classification).
   */
  readonly discovered = (element: Element, read: ThreadPostReader = this.readPost): void => {
    if (this.settledElements.has(element)) {
      return;
    }
    const reading: ThreadPostReading = read(element);
    if (reading === NOT_YET_READABLE) {
      return;
    }
    this.settledElements.add(element);
    if (reading === undefined) {
      return;
    }
    if (isThreadRoot(reading)) {
      this.recordRootLinks(reading.threadKey, reading.links);
      return;
    }
    this.replies.record(reading);
    this.linkedDomains.recordReply(placementOf(reading));
    this.recordPostLinks(reading.replyId, reading.links ?? []);
  };

  /** The links a thread's root carries, which never count for the thread's replies. */
  readonly recordRootLinks = (threadKey: string, links: readonly string[]): void => {
    this.linkedDomains.recordRootDomains(threadKey, rareDomainsOf(links));
  };

  /** The links a reply carries, by post id: from the page's reader, or on X from Tier 1. */
  readonly recordPostLinks = (postId: string, links: readonly string[]): void => {
    this.linkedDomains.recordPostDomains(postId, rareDomainsOf(links));
  };

  /** The page navigated in place: its replies are forgotten (docs/privacy.md) and every post is read again. */
  readonly navigated = (): void => {
    this.settledElements = new WeakSet<Element>();
    this.replies.clear();
    this.linkedDomains.clear();
  };

  readonly copiedReplyCount = (author: string): number | undefined =>
    this.replies.copiedReplyCount(author);

  readonly sharedDomainCount = (author: string): number | undefined =>
    this.linkedDomains.sharedDomainCount(author);

  /**
   * The adapter's `toFeatures`: the platform's account features, which read only the account's
   * signals, followed by the page's coordination evidence for that account.
   */
  readonly withPageEvidence =
    (accountFeatures: (signals: AccountSignals) => Feature[]) =>
    (signals: AccountSignals): Feature[] => [
      ...accountFeatures(signals),
      ...nearDuplicateReplyFeatures(this.copiedReplyCount(signals.ref.handle)),
      ...sharedRareDomainFeatures(this.sharedDomainCount(signals.ref.handle), this.linkTier),
    ];

  /** `PlatformAdapter.onEvidenceChanged`: the authors whose evidence changed after they were scored. */
  readonly subscribe = (listener: AuthorsChangedListener): (() => void) => {
    const unsubscribers: Array<() => void> = [
      this.replies.subscribe(listener),
      this.linkedDomains.subscribe(listener),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  };
}
