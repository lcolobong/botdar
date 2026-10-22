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
  viewportInsetPx?: number;
  cardWidthPx?: number;
  /** Mounts or updates card content for the given anchor; returns the card's rendered height. */
  render: (anchor: Element) => number;
  hide: () => void;
  place: (placement: HoverCardPlacement) => void;
  now?: () => number;
}

export interface HoverController {
  requestOpen: (anchor: Element) => void;
  requestClose: () => void;
  /** The pointer entered the card itself: cancel a pending close. */
  holdOpen: () => void;
  closeNow: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

const DEFAULT_OPEN_DELAY_MS = 150;
const DEFAULT_CLOSE_DELAY_MS = 200;
const DEFAULT_VIEWPORT_INSET_PX = 8;
const DEFAULT_CARD_WIDTH_PX = 320;
const ANCHOR_GAP_PX = 4;

export function computePlacement(
  anchorRect: DOMRect,
  cardHeight: number,
  viewport: { width: number; height: number },
  options: { insetPx: number; cardWidthPx: number },
): HoverCardPlacement {
  const spaceBelow: number = viewport.height - anchorRect.bottom - options.insetPx;
  const above: boolean =
    spaceBelow < cardHeight + ANCHOR_GAP_PX && anchorRect.top > cardHeight + ANCHOR_GAP_PX;
  const top: number = above
    ? anchorRect.top - cardHeight - ANCHOR_GAP_PX
    : anchorRect.bottom + ANCHOR_GAP_PX;
  const maxLeft: number = viewport.width - options.cardWidthPx - options.insetPx;
  const left: number = Math.max(options.insetPx, Math.min(anchorRect.left, maxLeft));
  return { top, left, above };
}

export function createHoverController(options: HoverControllerOptions): HoverController {
  const openDelayMs: number = options.openDelayMs ?? DEFAULT_OPEN_DELAY_MS;
  const closeDelayMs: number = options.closeDelayMs ?? DEFAULT_CLOSE_DELAY_MS;
  const insetPx: number = options.viewportInsetPx ?? DEFAULT_VIEWPORT_INSET_PX;
  const cardWidthPx: number = options.cardWidthPx ?? DEFAULT_CARD_WIDTH_PX;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let openAnchor: Element | undefined;

  const clearTimers = (): void => {
    if (openTimer !== undefined) clearTimeout(openTimer);
    if (closeTimer !== undefined) clearTimeout(closeTimer);
    openTimer = undefined;
    closeTimer = undefined;
  };

  const show = (anchor: Element): void => {
    const cardHeight: number = options.render(anchor);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    options.place(
      computePlacement(anchor.getBoundingClientRect(), cardHeight, viewport, {
        insetPx,
        cardWidthPx,
      }),
    );
    openAnchor = anchor;
  };

  const closeNow = (): void => {
    clearTimers();
    if (openAnchor === undefined) return;
    openAnchor = undefined;
    options.hide();
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
    requestClose(): void {
      clearTimers();
      if (openAnchor === undefined) return;
      closeTimer = setTimeout(closeNow, closeDelayMs);
    },
    holdOpen(): void {
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      closeTimer = undefined;
    },
    closeNow,
    isOpen: (): boolean => openAnchor !== undefined,
    dispose(): void {
      closeNow();
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
