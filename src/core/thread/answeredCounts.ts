/**
 * The per-author answers a thread index has handed out, kept current as the page's posts arrive
 * (ADR-0027). An index computes a count only when an account is scored; once it has answered for an
 * author it recomputes that author's count when a later post could change it and tells the
 * listeners, so the resolver rescores the account. An author asked about before any of their posts
 * could be counted is held with `undefined`, so a countable post recorded later still reaches the
 * listeners.
 */

/** Called with the authors whose count changed after they were last asked for it. */
export type AuthorsChangedListener = (authors: readonly string[]) => void;

export class AnsweredCounts {
  private readonly counts = new Map<string, number | undefined>();
  private readonly listeners = new Set<AuthorsChangedListener>();

  /** No answer handed out yet: a recorded post cannot change anything the resolver holds. */
  get isEmpty(): boolean {
    return this.counts.size === 0;
  }

  has(author: string): boolean {
    return this.counts.has(author);
  }

  /** The author's kept answer, or `count()` kept as the answer from now on. */
  answer(author: string, count: () => number | undefined): number | undefined {
    if (this.counts.has(author)) {
      return this.counts.get(author);
    }
    const answered: number | undefined = count();
    this.counts.set(author, answered);
    return answered;
  }

  /** Recomputes the answered authors among `authors` and tells the listeners whose count changed. */
  refresh(authors: Iterable<string>, countFor: (author: string) => number | undefined): void {
    const changed: string[] = [];
    for (const author of authors) {
      if (!this.counts.has(author)) {
        continue;
      }
      const count: number | undefined = countFor(author);
      if (count !== this.counts.get(author)) {
        this.counts.set(author, count);
        changed.push(author);
      }
    }
    this.notify(changed);
  }

  /** Navigation: forgets every answer, and tells the authors who had a count above 0. */
  clear(): void {
    const flagged: string[] = [...this.counts]
      .filter(([, count]) => count !== undefined && count > 0)
      .map(([author]) => author);
    this.counts.clear();
    this.notify(flagged);
  }

  subscribe(listener: AuthorsChangedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

export function appendTo<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const existing: Value[] | undefined = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
  } else {
    existing.push(value);
  }
}
