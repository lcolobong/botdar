/**
 * In-memory TTL + LRU cache. Per ADR-0012 this is the only place account signals and Tier 2 lookup
 * results live: per tab, bounded, and gone when the tab closes.
 */

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TtlLruCache<K, V> {
  /** Map iteration order is insertion order; re-inserting on access makes the first key the LRU. */
  private readonly entries = new Map<K, CacheEntry<V>>();

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`TtlLruCache capacity must be a positive integer, got ${capacity}`);
    }
    if (!(ttlMs > 0)) {
      throw new RangeError(`TtlLruCache ttlMs must be positive, got ${ttlMs}`);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const entry: CacheEntry<V> | undefined = this.liveEntry(key);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: K): boolean {
    return this.liveEntry(key) !== undefined;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    if (this.entries.size > this.capacity) {
      this.evictLeastRecentlyUsed();
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private liveEntry(key: K): CacheEntry<V> | undefined {
    const entry: CacheEntry<V> | undefined = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private evictLeastRecentlyUsed(): void {
    const oldestKey: K | undefined = this.entries.keys().next().value;
    if (oldestKey !== undefined) {
      this.entries.delete(oldestKey);
    }
  }
}
