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
}

interface IndexedReply {
  threadKey: string;
  replyId: string;
  author: string;
  postedAt: number;
  parentId: string | undefined;
  words: ReadonlySet<string>;
}

/** Called with the authors whose count changed after they were last asked for it. */
export type CopiedReplyListener = (authors: readonly string[]) => void;

/**
 * A ceiling on the replies one page holds. Past it new replies are not recorded: the feature then
 * misses copies deep in an enormous thread rather than growing without bound.
 */
export const MAX_INDEXED_REPLIES = 5_000;

export class ThreadIndex {
  private readonly repliesByThread = new Map<string, IndexedReply[]>();
  private readonly repliesByAuthor = new Map<string, IndexedReply[]>();
  private readonly recordedKeys = new Set<string>();
  /**
   * Answers handed out, kept current as replies arrive. An author asked about before any reply of
   * theirs could be compared is held with `undefined`, so a comparable reply recorded later still
   * reaches the listeners.
   */
  private readonly answeredCounts = new Map<string, number | undefined>();
  private readonly listeners = new Set<CopiedReplyListener>();

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
    const indexed: IndexedReply = {
      threadKey: reply.threadKey,
      replyId: reply.replyId,
      author: reply.author,
      postedAt: reply.postedAt,
      parentId: reply.parentId,
      words,
    };
    appendTo(this.repliesByThread, indexed.threadKey, indexed);
    appendTo(this.repliesByAuthor, indexed.author, indexed);
    this.notify(this.refreshCountsAffectedBy(indexed));
  }

  /**
   * How many other authors posted a near copy of this author's reply earlier in the same thread,
   * the most over the author's replies on the page; undefined when none of its replies on the page
   * is long enough to compare.
   */
  copiedReplyCount(author: string): number | undefined {
    if (this.answeredCounts.has(author)) {
      return this.answeredCounts.get(author);
    }
    const count: number | undefined = this.repliesByAuthor.has(author)
      ? this.countFor(author)
      : undefined;
    this.answeredCounts.set(author, count);
    return count;
  }

  subscribe(listener: CopiedReplyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Navigation: forgets every reply, and tells the authors who had a count above 0. */
  clear(): void {
    const flagged: string[] = [...this.answeredCounts]
      .filter(([, count]) => count !== undefined && count > 0)
      .map(([author]) => author);
    this.repliesByThread.clear();
    this.repliesByAuthor.clear();
    this.recordedKeys.clear();
    this.answeredCounts.clear();
    this.notify(flagged);
  }

  private countFor(author: string): number {
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
  private refreshCountsAffectedBy(reply: IndexedReply): string[] {
    if (this.answeredCounts.size === 0) {
      return [];
    }
    const affected = new Set<string>();
    if (this.answeredCounts.has(reply.author)) {
      affected.add(reply.author);
    }
    for (const later of this.repliesByThread.get(reply.threadKey) ?? []) {
      if (
        !affected.has(later.author) &&
        this.answeredCounts.has(later.author) &&
        isEarlierSourceFor(reply, later) &&
        areNearDuplicates(reply.words, later.words)
      ) {
        affected.add(later.author);
      }
    }
    const changed: string[] = [];
    for (const author of affected) {
      const count: number = this.countFor(author);
      if (count !== this.answeredCounts.get(author)) {
        this.answeredCounts.set(author, count);
        changed.push(author);
      }
    }
    return changed;
  }

  private notify(authors: readonly string[]): void {
    if (authors.length === 0) {
      return;
    }
    for (const listener of this.listeners) {
      listener(authors);
    }
  }
}

/**
 * Strictly earlier, by someone else, and not the reply's own parent. Two replies with the same time
 * are neither's source, so a tie never flags anyone.
 */
function isEarlierSourceFor(source: IndexedReply, reply: IndexedReply): boolean {
  return (
    source.author !== reply.author &&
    source.postedAt < reply.postedAt &&
    source.replyId !== reply.parentId
  );
}

function appendTo<Key>(map: Map<Key, IndexedReply[]>, key: Key, reply: IndexedReply): void {
  const existing: IndexedReply[] | undefined = map.get(key);
  if (existing === undefined) {
    map.set(key, [reply]);
  } else {
    existing.push(reply);
  }
}
