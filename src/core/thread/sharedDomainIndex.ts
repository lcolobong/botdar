/**
 * The page's index of the rare domains thread replies link, behind the shared rare domain feature
 * (ADR-0029). The feature asks how many other authors had already linked the same rare domain
 * earlier in the same thread as one of an account's replies. As for near-duplicate replies
 * (ADR-0027) only earlier replies by someone else count, never the reply's own parent, so the
 * first accounts to link a site score 0 and a real person cannot be flagged by others linking
 * their site after them; and the domain the thread's root post links never counts, since replies
 * discussing a story link its site.
 *
 * A reply's place in its thread and the domains it links are recorded apart and joined by post id,
 * because on X the domains arrive from the page's own API responses and the reply from the DOM, in
 * either order. Places are page state, cleared on navigation like the near-duplicate index; the
 * domains of each post and of each thread's root are kept past an in-place navigation, because X
 * does not fetch a thread's posts again when the page returns to it (or opens a photo over it), and
 * are capped instead. Roots are held apart from posts so that a busy page's posts never push a
 * thread's own site out. It holds registrable domains, never a link's path, in memory only
 * (docs/privacy.md).
 */
import { AnsweredCounts, appendTo } from "./answeredCounts";
import type { AuthorsChangedListener } from "./answeredCounts";
import type { ReplyPlacement } from "./threadIndex";
import { MAX_INDEXED_REPLIES, isEarlierSourceFor } from "./threadIndex";

export class SharedDomainIndex {
  private readonly placesById = new Map<string, ReplyPlacement>();
  /** Insertion-ordered, so past the cap the oldest post's domains are dropped first. */
  private readonly domainsByPostId = new Map<string, ReadonlySet<string>>();
  /** The domains each thread's root links, by thread key; insertion-ordered like the posts'. */
  private readonly rootDomainsByThread = new Map<string, ReadonlySet<string>>();
  /** Replies whose place and domains have both arrived, by thread and domain. */
  private readonly linkersByThreadDomain = new Map<string, ReplyPlacement[]>();
  private readonly linkingRepliesByAuthor = new Map<string, ReplyPlacement[]>();
  private readonly joinedReplyIds = new Set<string>();
  private readonly answered = new AnsweredCounts();

  /** A reply's place in its thread; the first record of an id wins. */
  recordReply(place: ReplyPlacement): void {
    if (this.placesById.has(place.replyId) || this.placesById.size >= MAX_INDEXED_REPLIES) {
      return;
    }
    this.placesById.set(place.replyId, place);
    this.join(place.replyId);
  }

  /** The rare domains a reply links. The first record of an id wins; one that links none is not kept. */
  recordPostDomains(postId: string, domains: ReadonlySet<string>): void {
    if (domains.size === 0 || this.domainsByPostId.has(postId)) {
      return;
    }
    if (this.domainsByPostId.size >= MAX_INDEXED_REPLIES) {
      this.evictOldestPost();
    }
    this.domainsByPostId.set(postId, domains);
    this.join(postId);
  }

  /** The domains a thread's root links, which never count for the replies in that thread. */
  recordRootDomains(threadKey: string, domains: ReadonlySet<string>): void {
    if (domains.size === 0 || this.rootDomainsByThread.has(threadKey)) {
      return;
    }
    if (this.rootDomainsByThread.size >= MAX_INDEXED_REPLIES) {
      const oldest: string | undefined = this.rootDomainsByThread.keys().next().value;
      if (oldest !== undefined) {
        this.rootDomainsByThread.delete(oldest);
      }
    }
    this.rootDomainsByThread.set(threadKey, domains);
    const affected: string[] = [...domains].flatMap((domain) =>
      this.linkersOf(threadKey, domain).map((linker) => linker.author),
    );
    this.answered.refresh(affected, (author) => this.countFor(author));
  }

  /**
   * How many other authors linked a rare domain earlier in the same thread than one of the author's
   * replies did, the most over the author's replies and their domains; undefined when none of the
   * author's replies on the page links a domain that counts.
   */
  sharedDomainCount(author: string): number | undefined {
    return this.answered.answer(author, () => this.countFor(author));
  }

  subscribe(listener: AuthorsChangedListener): () => void {
    return this.answered.subscribe(listener);
  }

  /** Navigation: forgets every reply's place, and tells the authors who had a count above 0. */
  clear(): void {
    this.placesById.clear();
    this.linkersByThreadDomain.clear();
    this.linkingRepliesByAuthor.clear();
    this.joinedReplyIds.clear();
    this.answered.clear();
  }

  private join(replyId: string): void {
    const place: ReplyPlacement | undefined = this.placesById.get(replyId);
    const domains: ReadonlySet<string> | undefined = this.domainsByPostId.get(replyId);
    if (place === undefined || domains === undefined || this.joinedReplyIds.has(replyId)) {
      return;
    }
    this.joinedReplyIds.add(replyId);
    appendTo(this.linkingRepliesByAuthor, place.author, place);
    for (const domain of domains) {
      appendTo(this.linkersByThreadDomain, linkerKey(place.threadKey, domain), place);
    }
    this.refreshAround(place, domains);
  }

  /**
   * Past the cap the oldest post's domains are dropped. A joined reply leaves the linker lists with
   * them, so it stops counting for everyone, its own author included, rather than counting for
   * others while its author's answer goes blank. Its place stays, and its domains join again if
   * they are recorded again.
   */
  private evictOldestPost(): void {
    const oldest: string | undefined = this.domainsByPostId.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    const domains: ReadonlySet<string> | undefined = this.domainsByPostId.get(oldest);
    this.domainsByPostId.delete(oldest);
    const place: ReplyPlacement | undefined = this.placesById.get(oldest);
    if (domains === undefined || place === undefined || !this.joinedReplyIds.delete(oldest)) {
      return;
    }
    removeFrom(this.linkingRepliesByAuthor, place.author, place);
    for (const domain of domains) {
      removeFrom(this.linkersByThreadDomain, linkerKey(place.threadKey, domain), place);
    }
    this.refreshAround(place, domains);
  }

  /**
   * A reply joining or leaving the index changes its own author's count and those of the later
   * linkers of its domains, for whom it is an earlier source; earlier linkers cannot change.
   */
  private refreshAround(place: ReplyPlacement, domains: ReadonlySet<string>): void {
    if (this.answered.isEmpty) {
      return;
    }
    const affected = new Set<string>([place.author]);
    for (const domain of domains) {
      for (const linker of this.linkersOf(place.threadKey, domain)) {
        if (isEarlierSourceFor(place, linker)) {
          affected.add(linker.author);
        }
      }
    }
    this.answered.refresh(affected, (author) => this.countFor(author));
  }

  private countFor(author: string): number | undefined {
    let mostOthers: number | undefined;
    for (const reply of this.linkingRepliesByAuthor.get(author) ?? []) {
      const rootDomains: ReadonlySet<string> | undefined = this.rootDomainsByThread.get(
        reply.threadKey,
      );
      for (const domain of this.domainsByPostId.get(reply.replyId) ?? []) {
        if (rootDomains?.has(domain) !== true) {
          mostOthers = Math.max(mostOthers ?? 0, this.earlierLinkers(reply, domain).size);
        }
      }
    }
    return mostOthers;
  }

  /** Distinct other authors who linked the domain in the reply's thread before it. */
  private earlierLinkers(reply: ReplyPlacement, domain: string): Set<string> {
    const authors = new Set<string>();
    for (const linker of this.linkersOf(reply.threadKey, domain)) {
      if (isEarlierSourceFor(linker, reply)) {
        authors.add(linker.author);
      }
    }
    return authors;
  }

  private linkersOf(threadKey: string, domain: string): readonly ReplyPlacement[] {
    return this.linkersByThreadDomain.get(linkerKey(threadKey, domain)) ?? [];
  }
}

function linkerKey(threadKey: string, domain: string): string {
  return `${threadKey}\n${domain}`;
}

function removeFrom<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const remaining: Value[] = (map.get(key) ?? []).filter((existing) => existing !== value);
  if (remaining.length === 0) {
    map.delete(key);
  } else {
    map.set(key, remaining);
  }
}
