// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}

import type { PostRef } from "@/src/core/types";
import { PASS_DELAY_MS, observeFeed } from "@/src/platforms/x/observer";
import {
  controlledObserver,
  installControlledIntersectionObserver,
} from "../../controlledIntersectionObserver";
import { loadTimeline, timelineArticles, timelineBodyHtml } from "./timelineFixture";

interface Harness {
  onPost: ReturnType<typeof vi.fn>;
  onRemoved: ReturnType<typeof vi.fn>;
  onRouteChange: ReturnType<typeof vi.fn>;
  stop: () => void;
}

function start(): Harness {
  const onPost = vi.fn();
  const onRemoved = vi.fn();
  const onRouteChange = vi.fn();
  const stop: () => void = observeFeed({ onPost, onRemoved, onRouteChange });
  return { onPost, onRemoved, onRouteChange, stop };
}

const handles = (onPost: ReturnType<typeof vi.fn>): string[] =>
  onPost.mock.calls.map((call) => (call[0] as PostRef).ref.handle);

/** Lets the MutationObserver deliver its records, then runs the coalesced pass. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(PASS_DELAY_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/home");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("observeFeed", () => {
  it("emits every post already on the page after one coalesced pass", async () => {
    loadTimeline();
    const { onPost, stop } = start();
    expect(onPost).not.toHaveBeenCalled();
    await settle();
    expect(handles(onPost)).toEqual(["alice_example", "kai09127364", "maria_dev", "mila48213907"]);
    stop();
  });

  it("emits posts added later exactly once, whatever the number of mutations", async () => {
    const { onPost, stop } = start();
    await settle();
    expect(onPost).not.toHaveBeenCalled();

    loadTimeline();
    document.body.append(document.createElement("div"));
    document.body.append(document.createElement("div"));
    await settle();
    expect(onPost).toHaveBeenCalledTimes(4);

    document.body.append(document.createElement("div"));
    await settle();
    expect(onPost).toHaveBeenCalledTimes(4);
    stop();
  });

  it("releases a removed post, also when its cell is what gets removed", async () => {
    loadTimeline();
    const { onRemoved, stop } = start();
    await settle();
    const [first, second] = timelineArticles();
    if (first === undefined || second === undefined) throw new Error("fixture has no posts");

    first.remove();
    second.parentElement?.remove();
    await settle();
    expect(onRemoved.mock.calls.map((call) => call[0])).toEqual([first, second]);
    stop();
  });

  it("re-emits a post that is removed and inserted again as a new element", async () => {
    loadTimeline();
    const { onPost, onRemoved, stop } = start();
    await settle();
    const cell: Element | null = document.querySelector('[data-testid="cellInnerDiv"]');
    if (cell === null) throw new Error("fixture has no cell");
    const html: string = cell.outerHTML;
    cell.remove();
    await settle();
    expect(onRemoved).toHaveBeenCalledTimes(1);

    document.body.insertAdjacentHTML("afterbegin", html);
    await settle();
    expect(handles(onPost)).toEqual([
      "alice_example",
      "kai09127364",
      "maria_dev",
      "mila48213907",
      "alice_example",
    ]);
    stop();
  });

  it("reports a route change seen on a pass and on popstate", async () => {
    const { onRouteChange, stop } = start();
    await settle();
    expect(onRouteChange).not.toHaveBeenCalled();

    history.pushState(null, "", "/alice_example/with_replies");
    document.body.append(document.createElement("div"));
    await settle();
    expect(onRouteChange).toHaveBeenCalledWith("https://x.com/alice_example/with_replies");

    history.replaceState(null, "", "/home");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settle();
    expect(onRouteChange).toHaveBeenLastCalledWith("https://x.com/home");
    expect(onRouteChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it("analyses a post once it comes near the viewport and forgets one removed before", async () => {
    const restore: () => void = installControlledIntersectionObserver();
    loadTimeline();
    const { onPost, onRemoved, stop } = start();
    await settle();
    const [first, second] = timelineArticles();
    if (first === undefined || second === undefined) throw new Error("fixture has no posts");
    expect(onPost).not.toHaveBeenCalled();

    controlledObserver().deliver([second], true);
    await settle();
    expect(handles(onPost)).toEqual(["kai09127364"]);

    first.remove();
    await settle();
    expect(controlledObserver().observed.has(first)).toBe(false);
    expect(onRemoved).not.toHaveBeenCalled();
    stop();
    restore();
  });

  it("stops observing and cancels a pending pass on stop", async () => {
    const { onPost, stop } = start();
    stop();
    document.body.innerHTML = timelineBodyHtml();
    await settle();
    expect(onPost).not.toHaveBeenCalled();
  });
});
