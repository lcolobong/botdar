// @vitest-environment happy-dom

import type { NearViewportGate } from "@/src/core/nearViewport";
import { NEAR_VIEWPORT_MARGIN, createNearViewportGate } from "@/src/core/nearViewport";
import {
  controlledObserver,
  installControlledIntersectionObserver,
} from "./controlledIntersectionObserver";

describe("createNearViewportGate", () => {
  let restore: () => void = () => undefined;
  beforeEach(() => {
    restore = installControlledIntersectionObserver();
  });
  afterEach(() => restore());

  const posts = (count: number): HTMLElement[] =>
    Array.from({ length: count }, () => document.body.appendChild(document.createElement("div")));

  it("watches with a margin of one screen and reports a post once it comes near", () => {
    const near = vi.fn();
    const gate: NearViewportGate = createNearViewportGate(window, near);
    const [first, second] = posts(2);
    if (first === undefined || second === undefined) throw new Error("posts missing");

    gate.watch(first);
    gate.watch(second);
    expect(controlledObserver().options?.rootMargin).toBe(NEAR_VIEWPORT_MARGIN);
    expect(near).not.toHaveBeenCalled();

    controlledObserver().deliver([first, second], false);
    expect(near).not.toHaveBeenCalled();
    controlledObserver().deliver([second], true);
    expect(near.mock.calls).toEqual([[second]]);
    expect([...controlledObserver().observed]).toEqual([first]);
  });

  it("reports an element with no layout box at once instead of never", () => {
    const near = vi.fn();
    const gate: NearViewportGate = createNearViewportGate(window, near);
    const [contents] = posts(1);
    if (contents === undefined) throw new Error("post missing");

    gate.watch(contents);
    controlledObserver().deliver([contents], false, { width: 0, height: 0 });

    expect(near.mock.calls).toEqual([[contents]]);
  });

  it("stops watching on unwatch and disconnect", () => {
    const gate: NearViewportGate = createNearViewportGate(window, vi.fn());
    const [first, second] = posts(2);
    if (first === undefined || second === undefined) throw new Error("posts missing");

    gate.watch(first);
    gate.watch(second);
    gate.unwatch(first);
    expect([...controlledObserver().observed]).toEqual([second]);
    gate.disconnect();
    expect(controlledObserver().observed.size).toBe(0);
  });

  it("treats every post as near where IntersectionObserver is missing", () => {
    const near = vi.fn();
    const gate: NearViewportGate = createNearViewportGate({}, near);
    const [post] = posts(1);
    if (post === undefined) throw new Error("post missing");

    gate.watch(post);

    expect(near.mock.calls).toEqual([[post]]);
  });
});
