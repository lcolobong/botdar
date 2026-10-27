/**
 * The page's index of thread replies behind the near-duplicate reply feature (ADR-0027). Each
 * platform's observer records the replies it discovers; the feature asks how many other authors had
 * already posted a near copy of an account's reply in the same thread. Only earlier replies count,
 * so the first author of a text always scores 0 and copying a real person's reply cannot get that
 * person flagged.
 *
 * It holds word sets, never the text, and lives in memory for one page: the owner clears it on
 * navigation (docs/privacy.md). Comparisons are made when an account is scored, not when a reply is
 * recorded, so discovering a thread of a thousand comments costs one normalisation per comment;
 * once an account has been scored its count is kept current, and the listeners hear when a reply
 * that arrived later changed it.
 */
import { areNearDuplicates, comparableWords } from "../text/replySimilarity";
import type { AuthorsChangedListener } from "./answeredCounts";
import { AnsweredCounts, appendTo } from "./answeredCounts";

export interface ThreadReply {
  /** The thread the reply belongs to, normally its root post's id. */
  threadKey: string;
  /** Unique within the thread; a post the page re-renders is recorded once. */
  replyId: string;
  /** The author's `AccountRef.handle`. */
  author: string;
  text: string;
  /** Epoch milliseconds the platform shows for the reply; decides who posted a text first. */
  postedAt: number;
  /** The reply this one answers, when the page says; quoting a parent is not copying it. */
  parentId?: string;
  /** The absolute links in the reply's own words (ADR-0029); omitted when it has none. */
  links?: readonly string[];
}

/** Where a reply sits in its thread: what deciding whether one reply is another's source needs. */
export type ReplyPlacement = Pick<
  ThreadReply,
  "threadKey" | "replyId" | "author" | "postedAt" | "parentId"
>;

interface IndexedReply extends ReplyPlacement {
  words: ReadonlySet<string>;
}

/**
 * A ceiling on the replies one page holds. Past it new replies are not recorded: the feature then
 * misses copies deep in an enormous thread rather than growing without bound.
 */
export const MAX_INDEXED_REPLIES = 5_000;

export class ThreadIndex {
  private readonly repliesByThread = new Map<string, IndexedReply[]>();
  private readonly repliesByAuthor = new Map<string, IndexedReply[]>();
  private readonly recordedKeys = new Set<string>();
  private readonly answered = new AnsweredCounts();

  /** Replies held, for the memory ceiling and the tests. */
  get size(): number {
    return this.recordedKeys.size;
  }

  record(reply: ThreadReply): void {
    const key: string = `${reply.threadKey}\n${reply.replyId}`;
    if (this.recordedKeys.has(key) || this.recordedKeys.size >= MAX_INDEXED_REPLIES) {
      return;
    }
    const words: ReadonlySet<string> | undefined = comparableWords(reply.text);
    if (words === undefined) {
      return;
    }
    this.recordedKeys.add(key);
    const indexed: IndexedReply = { ...placementOf(reply), words };
    appendTo(this.repliesByThread, indexed.threadKey, indexed);
    appendTo(this.repliesByAuthor, indexed.author, indexed);
    this.answered.refresh(this.authorsAffectedBy(indexed), (author) => this.countFor(author));
  }

  /**
   * How many other authors posted a near copy of this author's reply earlier in the same thread,
   * the most over the author's replies on the page; undefined when none of its replies on the page
   * is long enough to compare.
   */
  copiedReplyCount(author: string): number | undefined {
    return this.answered.answer(author, () => this.countFor(author));
  }

  subscribe(listener: AuthorsChangedListener): () => void {
    return this.answered.subscribe(listener);
  }

  /** Navigation: forgets every reply, and tells the authors who had a count above 0. */
  clear(): void {
    this.repliesByThread.clear();
    this.repliesByAuthor.clear();
    this.recordedKeys.clear();
    this.answered.clear();
  }

  /** Undefined when none of the author's replies on the page is long enough to compare. */
  private countFor(author: string): number | undefined {
    if (!this.repliesByAuthor.has(author)) {
      return undefined;
    }
    let mostSources = 0;
    for (const reply of this.repliesByAuthor.get(author) ?? []) {
      mostSources = Math.max(mostSources, this.earlierSourceAuthors(reply).size);
    }
    return mostSources;
  }

  /** Distinct other authors with an earlier near copy of the reply; one author's repeats count once. */
  private earlierSourceAuthors(reply: IndexedReply): Set<string> {
    const sources = new Set<string>();
    for (const candidate of this.repliesByThread.get(reply.threadKey) ?? []) {
      if (
        isEarlierSourceFor(candidate, reply) &&
        !sources.has(candidate.author) &&
        areNearDuplicates(candidate.words, reply.words)
      ) {
        sources.add(candidate.author);
      }
    }
    return sources;
  }

  /**
   * A new reply changes an answered count when it is the author's own (it may have sources) or an
   * earlier source for a later reply by an answered author. Authors never asked about are left
   * alone, which keeps a thread's first discovery pass free of comparisons.
   */
  private authorsAffectedBy(reply: IndexedReply): Set<string> {
    const affected = new Set<string>();
    if (this.answered.isEmpty) {
      return affected;
    }
    affected.add(reply.author);
    for (const later of this.repliesByThread.get(reply.threadKey) ?? []) {
      if (
        !affected.has(later.author) &&
        this.answered.has(later.author) &&
        isEarlierSourceFor(reply, later) &&
        areNearDuplicates(reply.words, later.words)
      ) {
        affected.add(later.author);
      }
    }
    return affected;
  }
}

/**
 * Strictly earlier, by someone else, and not the reply's own parent. Two replies with the same time
 * are neither's source, so a tie never flags anyone.
 */
export function isEarlierSourceFor(source: ReplyPlacement, reply: ReplyPlacement): boolean {
  return (
    source.author !== reply.author &&
    source.postedAt < reply.postedAt &&
    source.replyId !== reply.parentId
  );
}

/** The reply without its text, which an index never keeps. */
export function placementOf(reply: ThreadReply): ReplyPlacement {
  const { threadKey, replyId, author, postedAt, parentId } = reply;
  return parentId === undefined
    ? { threadKey, replyId, author, postedAt }
    : { threadKey, replyId, author, postedAt, parentId };
}
