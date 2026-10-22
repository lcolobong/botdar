/**
 * An IntersectionObserver whose entries the test delivers by hand, for the laziness tests. The
 * global double in tests/setup reports everything as intersecting at once; install this one to
 * decide which posts are near the viewport.
 */
export class ControlledIntersectionObserver {
  static latest: ControlledIntersectionObserver | undefined;
  readonly observed = new Set<Element>();
  readonly options: IntersectionObserverInit | undefined;
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    ControlledIntersectionObserver.latest = this;
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Delivers one entry per target; a box of 0×0 stands for an element with no layout box. */
  deliver(targets: Element[], isIntersecting: boolean, box = { width: 300, height: 80 }): void {
    const entries = targets.map(
      (target) =>
        ({
          target,
          isIntersecting,
          boundingClientRect: box,
        }) as unknown as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** Installs the controlled observer on the window; returns the function that restores the global one. */
export function installControlledIntersectionObserver(): () => void {
  const previous: unknown = window.IntersectionObserver;
  Object.assign(window, { IntersectionObserver: ControlledIntersectionObserver });
  ControlledIntersectionObserver.latest = undefined;
  return () => {
    Object.assign(window, { IntersectionObserver: previous });
  };
}

/** The observer the code under test created; throws when it created none. */
export function controlledObserver(): ControlledIntersectionObserver {
  const observer: ControlledIntersectionObserver | undefined =
    ControlledIntersectionObserver.latest;
  if (observer === undefined) throw new Error("no IntersectionObserver was created");
  return observer;
}
