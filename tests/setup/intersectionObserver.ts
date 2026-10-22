/**
 * happy-dom's IntersectionObserver never calls back, which would leave every lazily analysed post
 * unseen in DOM tests. This double reports each target as intersecting the moment it is observed,
 * the way a short feed that fits on screen behaves. Tests about laziness install their own.
 */
class EagerIntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: readonly number[] = [];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const entry = {
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: target.getBoundingClientRect(),
    } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }

  unobserve(): void {}

  disconnect(): void {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (typeof window !== "undefined") {
  Object.assign(window, { IntersectionObserver: EagerIntersectionObserver });
  Object.assign(globalThis, { IntersectionObserver: EagerIntersectionObserver });
}
