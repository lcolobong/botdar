// @vitest-environment happy-dom
import {
  computePlacement,
  createHoverController,
  type HoverController,
} from "@/src/ui/hoverController";

describe("computePlacement", () => {
  const viewport = { width: 1200, height: 800 };
  const options = { insetPx: 8, cardWidthPx: 320 };

  it("places the card below the anchor when there is room", () => {
    const rect: DOMRect = new DOMRect(100, 100, 80, 16);
    expect(computePlacement(rect, 200, viewport, options)).toEqual({
      top: 120,
      left: 100,
      above: false,
    });
  });

  it("flips above when the card would run off the bottom", () => {
    const rect: DOMRect = new DOMRect(100, 700, 80, 16);
    expect(computePlacement(rect, 200, viewport, options)).toEqual({
      top: 496,
      left: 100,
      above: true,
    });
  });

  it("keeps the card inside the viewport vertically, overlapping the badge if it must", () => {
    const rect: DOMRect = new DOMRect(100, 300, 80, 16);
    const short = { width: 1200, height: 500 };
    expect(computePlacement(rect, 400, short, options)).toEqual({
      top: 92,
      left: 100,
      above: false,
    });
    expect(computePlacement(rect, 600, short, options).top).toBe(8);
    expect(computePlacement(rect, 400, short, { ...options, side: "above" }).top).toBe(8);
  });

  it("keeps the card inside the viewport horizontally", () => {
    const rect: DOMRect = new DOMRect(1100, 100, 80, 16);
    expect(computePlacement(rect, 200, viewport, options).left).toBe(872);
    expect(computePlacement(new DOMRect(0, 100, 80, 16), 200, viewport, options).left).toBe(8);
  });
});

describe("createHoverController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setup(cardHeight = 180) {
    const anchor: HTMLButtonElement = document.createElement("button");
    document.body.append(anchor);
    const render = vi.fn(() => cardHeight);
    const hide = vi.fn();
    const place = vi.fn();
    const controller = createHoverController({ render, hide, place });
    return { anchor, render, hide, place, controller };
  }

  it("opens after the intent delay and closes after the linger", () => {
    const { anchor, render, hide, controller } = setup();
    controller.requestOpen(anchor);
    expect(render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(render).toHaveBeenCalledWith(anchor);
    expect(controller.isOpen()).toBe(true);
    controller.requestClose();
    vi.advanceTimersByTime(199);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalled();
    expect(controller.isOpen()).toBe(false);
  });

  it("does not open when the pointer leaves before the delay", () => {
    const { anchor, render, controller } = setup();
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(100);
    controller.requestClose();
    vi.advanceTimersByTime(500);
    expect(render).not.toHaveBeenCalled();
  });

  it("stays open while the pointer is on the card and closes on Escape", () => {
    const { anchor, hide, controller } = setup();
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    controller.requestClose();
    controller.holdOpen();
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(hide).toHaveBeenCalled();
  });

  it("moves straight to a second anchor while already open", () => {
    const { anchor, render, controller } = setup();
    const second: HTMLButtonElement = document.createElement("button");
    document.body.append(second);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    controller.requestOpen(second);
    expect(render).toHaveBeenLastCalledWith(second);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("moves a card above the badge up as it grows, so it never covers the badge", () => {
    const { anchor, place, controller } = setup();
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 700, 80, 16));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    expect(place).toHaveBeenLastCalledWith({ top: 516, left: 100, above: true });
    controller.reposition(300);
    expect(place).toHaveBeenLastCalledWith({ top: 396, left: 100, above: true });
  });

  it("leaves a card below the badge where it is while it fits, and ignores a closed card", () => {
    const { anchor, place, controller } = setup();
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 80, 16));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    controller.reposition(300);
    expect(place).not.toHaveBeenCalled();
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    controller.reposition(300);
    expect(place).toHaveBeenCalledTimes(1);
  });

  it("keeps a grown card below its badge, clamped inside the viewport, rather than flipping", () => {
    // A short Checking card opens below with ~120px to spare, then the lookup lands. Flipping it
    // above would pull it away from a pointer on its way down from the badge.
    const { anchor, place, controller } = setup(120);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 600, 80, 16));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    expect(place).toHaveBeenLastCalledWith({ top: 620, left: 100, above: false });
    controller.reposition(280);
    expect(place).toHaveBeenLastCalledWith({ top: 512, left: 100, above: false });
  });

  it("keeps a grown card above its badge, clamped to the inset rather than off the top", () => {
    // Badge top 250, card 240 above it; opened to 320 its top would be -74.
    const { anchor, place, controller } = setup(240);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 250, 80, 16));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(480);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    expect(place).toHaveBeenLastCalledWith({ top: 8, left: 100, above: true });
    controller.reposition(320);
    expect(place).toHaveBeenCalledTimes(1);
  });

  it("places the card again when its badge has moved sideways", () => {
    const { anchor, place, controller } = setup();
    const rect = vi.spyOn(anchor, "getBoundingClientRect");
    rect.mockReturnValue(new DOMRect(100, 100, 80, 16));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    rect.mockReturnValue(new DOMRect(140, 100, 80, 16));
    controller.reposition(180);
    expect(place).toHaveBeenLastCalledWith({ top: 120, left: 140, above: false });
  });

  it("counts each opening before it renders, so the card can be keyed on it", () => {
    const anchor: HTMLButtonElement = document.createElement("button");
    const second: HTMLButtonElement = document.createElement("button");
    const seenAtRender: number[] = [];
    const controller: HoverController = createHoverController({
      render: () => {
        seenAtRender.push(controller.openings());
        return 180;
      },
      hide: () => {},
      place: () => {},
    });
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    controller.requestOpen(second);
    controller.closeNow();
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    expect(seenAtRender).toEqual([1, 2, 3]);
    controller.dispose();
  });

  it("ignores a close request while the pointer is in the card, until it leaves", () => {
    const { anchor, hide, controller } = setup();
    const card: HTMLDivElement = document.createElement("div");
    controller.bindCard(card);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    card.dispatchEvent(new Event("mouseenter"));
    // The badge's blur when a click lands on the card's text.
    controller.requestClose();
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();
    card.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(200);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("counts a press in the card as the pointer being there, and forgets it when the card hides", () => {
    const { anchor, hide, controller } = setup();
    const card: HTMLDivElement = document.createElement("div");
    controller.bindCard(card);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    card.dispatchEvent(new Event("pointerdown"));
    controller.requestClose();
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();

    controller.closeNow();
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    controller.requestClose();
    vi.advanceTimersByTime(200);
    expect(hide).toHaveBeenCalledTimes(2);
  });

  it("lets a touch press elsewhere close a card a touch press held open", () => {
    const { anchor, hide, controller } = setup();
    const card: HTMLDivElement = document.createElement("div");
    document.body.append(card);
    const unbind: () => void = controller.bindCard(card);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    const touch = (target: Element): boolean =>
      target.dispatchEvent(
        new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true, composed: true }),
      );
    touch(card);
    controller.requestClose();
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();
    // No mouseleave ever comes for a finger; the next press outside the card ends it.
    touch(document.body);
    vi.advanceTimersByTime(200);
    expect(hide).toHaveBeenCalledTimes(1);
    unbind();
  });

  it("only clears the hold on a mouse press elsewhere, so clicking the badge keeps the card", () => {
    const { anchor, hide, controller } = setup();
    const card: HTMLDivElement = document.createElement("div");
    document.body.append(card);
    const unbind: () => void = controller.bindCard(card);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    card.dispatchEvent(new Event("mouseenter"));
    anchor.dispatchEvent(
      new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true, composed: true }),
    );
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();
    controller.requestClose();
    vi.advanceTimersByTime(200);
    expect(hide).toHaveBeenCalledTimes(1);
    unbind();
  });

  it("closes when keyboard focus leaves the card, not when it moves within it", () => {
    const { anchor, hide, controller } = setup();
    const card: HTMLDivElement = document.createElement("div");
    const feedback: HTMLButtonElement = document.createElement("button");
    const settings: HTMLButtonElement = document.createElement("button");
    card.append(feedback, settings);
    document.body.append(card);
    const unbind: () => void = controller.bindCard(card);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    feedback.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: settings }));
    vi.advanceTimersByTime(500);
    expect(hide).not.toHaveBeenCalled();
    settings.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    vi.advanceTimersByTime(200);
    expect(hide).toHaveBeenCalledTimes(1);
    unbind();
  });

  it("gives a card clamped over its badge a longer close, which the card's mouseenter cancels", () => {
    // No room on either side: the card is clamped over the badge, under the pointer.
    const { anchor, hide, place, controller } = setup(400);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 300, 80, 16));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    const card: HTMLDivElement = document.createElement("div");
    const unbind: () => void = controller.bindCard(card);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    expect(place).toHaveBeenLastCalledWith({ top: 92, left: 100, above: false });
    // The badge's mouseleave as the card lands over it, then the card's mouseenter.
    controller.requestClose();
    vi.advanceTimersByTime(300);
    card.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(1000);
    expect(hide).not.toHaveBeenCalled();
    unbind();
  });

  it("still closes a card clamped over its badge when no mouseenter ever comes", () => {
    const { anchor, hide, controller } = setup(400);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 300, 80, 16));
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    controller.requestOpen(anchor);
    vi.advanceTimersByTime(150);
    controller.requestClose();
    vi.advanceTimersByTime(599);
    expect(hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("unbinds every bound card on dispose, document listener and observer included", () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect = disconnect;
      },
    );
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    try {
      const { controller } = setup();
      controller.bindCard(document.createElement("div"));
      controller.bindCard(document.createElement("div"));
      const pressListeners: unknown[] = added.mock.calls
        .filter(([type]) => type === "pointerdown")
        .map(([, listener]) => listener);
      expect(pressListeners).toHaveLength(2);
      controller.dispose();
      expect(disconnect).toHaveBeenCalledTimes(2);
      for (const listener of pressListeners) {
        expect(removed).toHaveBeenCalledWith("pointerdown", listener, true);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancels a pending open even when it ignores the close itself", () => {
    const { anchor, render, controller } = setup();
    const card: HTMLDivElement = document.createElement("div");
    const unbind: () => void = controller.bindCard(card);
    card.dispatchEvent(new Event("mouseenter"));
    controller.requestOpen(anchor);
    controller.requestClose();
    vi.advanceTimersByTime(500);
    expect(render).not.toHaveBeenCalled();
    unbind();
  });

  it("places the card again from the observed border-box height, and unbinds cleanly", () => {
    let deliver: (entries: Partial<ResizeObserverEntry>[]) => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: Partial<ResizeObserverEntry>[]) => void) {
          deliver = callback;
        }
        observe(): void {}
        disconnect = disconnect;
      },
    );
    try {
      const { anchor, place, controller } = setup();
      vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 700, 80, 16));
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
      const card: HTMLDivElement = document.createElement("div");
      const unbind: () => void = controller.bindCard(card);
      controller.requestOpen(anchor);
      vi.advanceTimersByTime(150);
      deliver([{ borderBoxSize: [{ blockSize: 300, inlineSize: 320 }] }]);
      expect(place).toHaveBeenLastCalledWith({ top: 396, left: 100, above: true });

      unbind();
      expect(disconnect).toHaveBeenCalled();
      card.dispatchEvent(new Event("mouseenter"));
      controller.requestClose();
      vi.advanceTimersByTime(200);
      expect(controller.isOpen()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
