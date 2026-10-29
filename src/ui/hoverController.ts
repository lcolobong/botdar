/**
 * One hover card per page. Opens after a short intent delay, lingers briefly after the pointer
 * leaves both badge and card, and flips above the badge when there is no room below.
 */
export interface HoverCardPlacement {
  top: number;
  left: number;
  above: boolean;
}

export interface HoverControllerOptions {
  openDelayMs?: number;
  closeDelayMs?: number;
  /** The close delay while the card covers its badge, long enough for the card's mouseenter. */
  coveredCloseDelayMs?: number;
  viewportInsetPx?: number;
  cardWidthPx?: number;
  /**
   * Mounts or updates card content for the given anchor; returns the card's rendered height, or
   * undefined when it displayed nothing, which leaves the card closed.
   */
  render: (anchor: Element) => number | undefined;
  hide: () => void;
  place: (placement: HoverCardPlacement) => void;
  now?: () => number;
}

export interface HoverController {
  requestOpen: (anchor: Element) => void;
  /** Ignored while the pointer is inside the card: only leaving the card closes it then. */
  requestClose: () => void;
  /** Cancels a pending close. */
  holdOpen: () => void;
  /** The open card changed height (a lookup landed, a section opened); clamp it on its side. */
  reposition: (cardHeight: number) => void;
  /**
   * Wires the card's container: the pointer and focus inside it hold the card open, leaving it
   * closes the card, and a change in its height repositions it. Returns the unbind; dispose()
   * also unbinds every container still bound.
   */
  bindCard: (container: HTMLElement) => () => void;
  /**
   * How many times a card has opened, counted before each opening renders. The card host is
   * mounted once and only hidden between openings, so the wires pass this to the card as its
   * `opening`, and anything it holds (its open why clauses, ADR-0023) starts fresh each time.
   */
  openings: () => number;
  closeNow: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

export interface PlacementOptions {
  insetPx: number;
  cardWidthPx: number;
  /** Keeps the card on this side of the anchor instead of choosing the side with room. */
  side?: "above" | "below";
}

const DEFAULT_OPEN_DELAY_MS = 150;
const DEFAULT_CLOSE_DELAY_MS = 200;
const DEFAULT_COVERED_CLOSE_DELAY_MS = 600;
const DEFAULT_VIEWPORT_INSET_PX = 8;
const DEFAULT_CARD_WIDTH_PX = 320;
const ANCHOR_GAP_PX = 4;

export function computePlacement(
  anchorRect: DOMRect,
  cardHeight: number,
  viewport: { width: number; height: number },
  options: PlacementOptions,
): HoverCardPlacement {
  const spaceBelow: number = viewport.height - anchorRect.bottom - options.insetPx;
  const above: boolean =
    options.side === undefined
      ? spaceBelow < cardHeight + ANCHOR_GAP_PX && anchorRect.top > cardHeight + ANCHOR_GAP_PX
      : options.side === "above";
  const preferredTop: number = above
    ? anchorRect.top - cardHeight - ANCHOR_GAP_PX
    : anchorRect.bottom + ANCHOR_GAP_PX;
  // A card taller than the room on its side overlaps the badge rather than leaving the viewport;
  // one taller than the viewport keeps its top, where the title is, on screen.
  const maxTop: number = viewport.height - options.insetPx - cardHeight;
  const top: number = Math.max(options.insetPx, Math.min(preferredTop, maxTop));
  const maxLeft: number = viewport.width - options.cardWidthPx - options.insetPx;
  const left: number = Math.max(options.insetPx, Math.min(anchorRect.left, maxLeft));
  return { top, left, above };
}

/** Whether a card at this placement lies over the anchor, as a clamped card can. */
export function placementCoversAnchor(
  placement: HoverCardPlacement,
  card: { width: number; height: number },
  anchorRect: DOMRect,
): boolean {
  return (
    placement.top < anchorRect.bottom &&
    placement.top + card.height > anchorRect.top &&
    placement.left < anchorRect.right &&
    placement.left + card.width > anchorRect.left
  );
}

/** The border-box height ResizeObserver delivers, so reading it forces no layout. */
function observedHeight(entry: ResizeObserverEntry): number {
  const borderBox: ResizeObserverSize | undefined = entry.borderBoxSize?.[0];
  return borderBox?.blockSize ?? entry.contentRect.height;
}

export function createHoverController(options: HoverControllerOptions): HoverController {
  const openDelayMs: number = options.openDelayMs ?? DEFAULT_OPEN_DELAY_MS;
  const closeDelayMs: number = options.closeDelayMs ?? DEFAULT_CLOSE_DELAY_MS;
  const coveredCloseDelayMs: number = options.coveredCloseDelayMs ?? DEFAULT_COVERED_CLOSE_DELAY_MS;
  const insetPx: number = options.viewportInsetPx ?? DEFAULT_VIEWPORT_INSET_PX;
  const cardWidthPx: number = options.cardWidthPx ?? DEFAULT_CARD_WIDTH_PX;
  const boundCardUnbinds = new Set<() => void>();
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let openAnchor: Element | undefined;
  let openPlacement: HoverCardPlacement | undefined;
  let pointerInCard = false;
  let cardCoversAnchor = false;
  let openingCount = 0;

  const clearTimers = (): void => {
    if (openTimer !== undefined) clearTimeout(openTimer);
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    openTimer = undefined;
    closeTimer = undefined;
  };

  /** Places the card and notes whether it lies over the anchor, from one read of the anchor. */
  const place = (anchor: Element, cardHeight: number, side: PlacementOptions["side"]): void => {
    const anchorRect: DOMRect = anchor.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const next: HoverCardPlacement = computePlacement(anchorRect, cardHeight, viewport, {
      insetPx,
      cardWidthPx,
      ...(side === undefined ? {} : { side }),
    });
    cardCoversAnchor = placementCoversAnchor(
      next,
      { width: cardWidthPx, height: cardHeight },
      anchorRect,
    );
    const unchanged: boolean =
      openPlacement !== undefined &&
      next.top === openPlacement.top &&
      next.left === openPlacement.left &&
      next.above === openPlacement.above;
    openPlacement = next;
    if (!unchanged) options.place(next);
  };

  const show = (anchor: Element): void => {
    pointerInCard = false;
    openPlacement = undefined;
    openingCount += 1;
    const cardHeight: number | undefined = options.render(anchor);
    if (cardHeight === undefined) {
      // Nothing was displayed, so nothing is open: no hide follows, and the next hover of this
      // anchor waits out the intent delay and renders again.
      openingCount -= 1;
      return;
    }
    place(anchor, cardHeight, undefined);
    openAnchor = anchor;
  };

  /**
   * The side is chosen once, at open. A grown card keeps it and is only clamped inside the
   * viewport: flipping would pull the card away from a pointer on its way from the badge, or out
   * from under one that just clicked in it, and every slow lookup would make the card jump.
   */
  const reposition = (cardHeight: number): void => {
    if (openAnchor === undefined || openPlacement === undefined) return;
    place(openAnchor, cardHeight, openPlacement.above ? "above" : "below");
  };

  const closeNow = (): void => {
    clearTimers();
    // A hidden card fires no mouseleave, so the flag would otherwise outlive it.
    pointerInCard = false;
    if (openAnchor === undefined) return;
    openAnchor = undefined;
    openPlacement = undefined;
    options.hide();
  };

  const holdOpen = (): void => {
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    closeTimer = undefined;
  };

  const requestClose = (): void => {
    // Cleared first either way, so a pending open for another badge cannot fire after this.
    clearTimers();
    // A click in the card blurs a focused badge, and the badge's blur asks to close; the pointer
    // is still in the card, so the request is not the reader's.
    if (pointerInCard || openAnchor === undefined) return;
    // A card clamped over its badge lands under a pointer resting there, and the badge's
    // mouseleave can come before the card's mouseenter; the longer delay gives that mouseenter
    // time to cancel the close, and still closes the card if the pointer really left.
    closeTimer = setTimeout(closeNow, cardCoversAnchor ? coveredCloseDelayMs : closeDelayMs);
  };

  const bindCard = (container: HTMLElement): (() => void) => {
    const pointerEntered = (): void => {
      pointerInCard = true;
      holdOpen();
    };
    const pointerLeft = (): void => {
      pointerInCard = false;
      requestClose();
    };
    // Keyboard focus leaving the card (Tab past Settings) closes it like the pointer leaving.
    const focusLeft = (event: FocusEvent): void => {
      const nextFocus: EventTarget | null = event.relatedTarget;
      if (nextFocus instanceof Node && container.contains(nextFocus)) return;
      requestClose();
    };
    // A touch or pen press never fires mouseleave, so a press elsewhere on the page is what ends
    // it being "in" the card, and closes the card. A mouse press elsewhere only clears the flag:
    // a click on the hovered badge must not close the card it opened.
    const pressedOutside = (event: PointerEvent): void => {
      if (event.composedPath().includes(container)) return;
      pointerInCard = false;
      if (event.pointerType !== "mouse") requestClose();
    };
    // pointerdown covers a press that lands without a mouseenter first (touch, pen).
    const listeners: [string, () => void][] = [
      ["mouseenter", pointerEntered],
      ["pointerdown", pointerEntered],
      ["focusin", holdOpen],
      ["mouseleave", pointerLeft],
    ];
    for (const [type, listener] of listeners) container.addEventListener(type, listener);
    container.addEventListener("focusout", focusLeft);
    document.addEventListener("pointerdown", pressedOutside, true);
    const observer: ResizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry: ResizeObserverEntry | undefined = entries[0];
      if (entry !== undefined) reposition(observedHeight(entry));
    });
    observer.observe(container);
    const unbind = (): void => {
      for (const [type, listener] of listeners) container.removeEventListener(type, listener);
      container.removeEventListener("focusout", focusLeft);
      document.removeEventListener("pointerdown", pressedOutside, true);
      observer.disconnect();
      boundCardUnbinds.delete(unbind);
    };
    boundCardUnbinds.add(unbind);
    return unbind;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeNow();
  };
  document.addEventListener("keydown", onKeyDown);

  return {
    requestOpen(anchor: Element): void {
      clearTimers();
      if (openAnchor === anchor) return;
      if (openAnchor !== undefined) {
        show(anchor);
        return;
      }
      openTimer = setTimeout((): void => show(anchor), openDelayMs);
    },
    requestClose,
    holdOpen,
    reposition,
    bindCard,
    openings: (): number => openingCount,
    closeNow,
    isOpen: (): boolean => openAnchor !== undefined,
    dispose(): void {
      closeNow();
      document.removeEventListener("keydown", onKeyDown);
      // A wire's unmount may never run (the page tore the card down first), and the document
      // listener and the observer would outlive the controller.
      for (const unbind of [...boundCardUnbinds]) unbind();
    },
  };
}
