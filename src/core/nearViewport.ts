/**
 * Lazy analysis for the feed observers (docs/performance.md, fix 3). A discovered post is only
 * extracted, scored and badged once it comes within about a screen of the viewport, so the first
 * pass costs what is on screen rather than everything the page has loaded, and the rest is analysed
 * as the reader scrolls towards it. Passive Tier 1 data for accounts not analysed yet still merges
 * into the resolver as it arrives; it is scored when the post comes near.
 */

/** One viewport height above and below the visible area. */
export const NEAR_VIEWPORT_MARGIN = "100% 0px";

export interface NearViewportGate {
  /** Calls the gate's `onNear` once, when the element comes near the viewport. */
  watch: (element: Element) => void;
  /** Stops watching an element that left the page before it came near. */
  unwatch: (element: Element) => void;
  disconnect: () => void;
}

type IntersectionHost = { IntersectionObserver?: typeof IntersectionObserver };

/**
 * An element with no box (`display: none` or `display: contents`) never intersects anything, so
 * it is reported at once rather than never: laziness applies only where the geometry is known.
 */
function isNearOrBoxless(entry: IntersectionObserverEntry): boolean {
  const { width, height } = entry.boundingClientRect;
  return entry.isIntersecting || (width === 0 && height === 0);
}

/** Without IntersectionObserver every watched element counts as near at once, as before. */
export function createNearViewportGate(
  view: IntersectionHost,
  onNear: (element: Element) => void,
): NearViewportGate {
  const Observer: typeof IntersectionObserver | undefined = view.IntersectionObserver;
  if (Observer === undefined) {
    return { watch: onNear, unwatch: () => undefined, disconnect: () => undefined };
  }
  const observer = new Observer(
    (entries: IntersectionObserverEntry[]): void => {
      for (const entry of entries) {
        if (!isNearOrBoxless(entry)) continue;
        observer.unobserve(entry.target);
        onNear(entry.target);
      }
    },
    { rootMargin: NEAR_VIEWPORT_MARGIN },
  );
  return {
    watch: (element) => observer.observe(element),
    unwatch: (element) => observer.unobserve(element),
    disconnect: () => observer.disconnect(),
  };
}
