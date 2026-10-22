// @vitest-environment happy-dom
import { computePlacement, createHoverController } from "@/src/ui/hoverController";

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

  it("keeps the card inside the viewport horizontally", () => {
    const rect: DOMRect = new DOMRect(1100, 100, 80, 16);
    expect(computePlacement(rect, 200, viewport, options).left).toBe(872);
    expect(computePlacement(new DOMRect(0, 100, 80, 16), 200, viewport, options).left).toBe(8);
  });
});

describe("createHoverController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const anchor: HTMLButtonElement = document.createElement("button");
    document.body.append(anchor);
    const render = vi.fn(() => 180);
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
});
