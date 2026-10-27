/**
 * A platform adapter's view of the page's thread index (ADR-0027): the observer hands it every post
 * it discovers, before the post comes near the viewport, so a reply is compared with the whole
 * thread the page holds and not only the part already scrolled past. A platform supplies the reader
 * that turns one of its post elements into a reply; everything else is the same on every platform.
 */
import { nearDuplicateReplyFeatures } from "../scoring/featureSupport";
import type { AccountSignals, Feature } from "../types";
import type { ReplyReading } from "./replyText";
import { NOT_YET_READABLE } from "./replyText";
import type { CopiedReplyListener } from "./threadIndex";
import { ThreadIndex } from "./threadIndex";

export type ReplyReader = (element: Element) => ReplyReading;

export class PageThreads {
  private readonly index = new ThreadIndex();
  /**
   * Elements already read to a final answer, a reply or not one, so a discovery pass that meets them
   * again (X and Bluesky rescan every post on each pass) makes no DOM read.
   */
  private settledElements = new WeakSet<Element>();

  constructor(private readonly readReply: ReplyReader) {}

  /**
   * The observer's discovery hook. Only an element whose markup has not finished rendering is read
   * again on a later pass. `read` overrides the reader for a platform whose observer already holds
   * part of the answer (Hacker News passes the row's classification).
   */
  readonly discovered = (element: Element, read: ReplyReader = this.readReply): void => {
    if (this.settledElements.has(element)) {
      return;
    }
    const reading: ReplyReading = read(element);
    if (reading === NOT_YET_READABLE) {
      return;
    }
    this.settledElements.add(element);
    if (reading !== undefined) {
      this.index.record(reading);
    }
  };

  /** The page navigated in place: its replies are forgotten (docs/privacy.md) and every post is read again. */
  readonly navigated = (): void => {
    this.settledElements = new WeakSet<Element>();
    this.index.clear();
  };

  readonly copiedReplyCount = (author: string): number | undefined =>
    this.index.copiedReplyCount(author);

  /**
   * The adapter's `toFeatures`: the platform's account features, which read only the account's
   * signals, followed by the page's near-duplicate reply evidence for that account.
   */
  readonly withPageEvidence =
    (accountFeatures: (signals: AccountSignals) => Feature[]) =>
    (signals: AccountSignals): Feature[] => [
      ...accountFeatures(signals),
      ...nearDuplicateReplyFeatures(this.copiedReplyCount(signals.ref.handle)),
    ];

  /** `PlatformAdapter.onEvidenceChanged`: the authors whose count changed after they were scored. */
  readonly subscribe = (listener: CopiedReplyListener): (() => void) =>
    this.index.subscribe(listener);
}
