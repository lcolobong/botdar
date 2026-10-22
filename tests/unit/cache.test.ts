import { TtlLruCache } from "@/src/core/cache";

describe("TtlLruCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and returns values", () => {
    const cache = new TtlLruCache<string, number>(2, 1000);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);
    expect(cache.size).toBe(1);
  });

  it("returns undefined for unknown keys", () => {
    const cache = new TtlLruCache<string, number>(2, 1000);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("missing")).toBe(false);
  });

  it("expires entries on read once the TTL has elapsed", () => {
    const cache = new TtlLruCache<string, number>(2, 1000);
    cache.set("a", 1);
    vi.advanceTimersByTime(999);
    expect(cache.get("a")).toBe(1);
    vi.advanceTimersByTime(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("refreshes the TTL when a key is set again", () => {
    const cache = new TtlLruCache<string, number>(2, 1000);
    cache.set("a", 1);
    vi.advanceTimersByTime(800);
    cache.set("a", 2);
    vi.advanceTimersByTime(800);
    expect(cache.get("a")).toBe(2);
  });

  it("evicts the least recently used entry when over capacity", () => {
    const cache = new TtlLruCache<string, number>(2, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("treats a read as recent use", () => {
    const cache = new TtlLruCache<string, number>(2, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("does not treat has() as recent use", () => {
    const cache = new TtlLruCache<string, number>(2, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.has("a");
    cache.set("c", 3);
    expect(cache.has("a")).toBe(false);
  });

  it("deletes and clears entries", () => {
    const cache = new TtlLruCache<string, number>(3, 1000);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has("b")).toBe(false);
  });

  it("accepts an injected clock", () => {
    let currentTime = 0;
    const cache = new TtlLruCache<string, number>(2, 100, () => currentTime);
    cache.set("a", 1);
    currentTime = 99;
    expect(cache.get("a")).toBe(1);
    currentTime = 100;
    expect(cache.get("a")).toBeUndefined();
  });

  it("rejects an invalid capacity or TTL", () => {
    expect(() => new TtlLruCache<string, number>(0, 1000)).toThrow(RangeError);
    expect(() => new TtlLruCache<string, number>(1.5, 1000)).toThrow(RangeError);
    expect(() => new TtlLruCache<string, number>(1, 0)).toThrow(RangeError);
  });
});
