// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/"}

import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { FeedbackEntry, FeedbackInput } from "@/src/core/feedback";
import type { BadgeHandle, LookupStatus } from "@/src/core/pipeline";
import type { Verdict, VerdictTier } from "@/src/core/types";
import { createHoverCardLayer, isLookingUp } from "@/src/ui/hoverCardLayer";
import type { HoverCardLayer, HoverCardTarget } from "@/src/ui/hoverCardLayer";
import { shouldDrawBadge } from "@/src/ui/labels";
import type { BadgeTier } from "@/src/ui/labels";
import { CARD_ELEMENT_NAME } from "@/src/ui/mount";
import { fakeReason } from "../fakeReasons";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 200;

const fakeContext = (): ContentScriptContext =>
  ({ options: {}, onInvalidated: () => () => undefined }) as unknown as ContentScriptContext;

const verdictOf = (tier: VerdictTier): Verdict => ({
  tier,
  probability: 0.8,
  logOdds: 1,
  evidence: [],
  reasons: [fakeReason("Joined 2 weeks ago")],
  confidence: 0.6,
  caveat: "This can be wrong.",
  sourcesUsed: [0],
  sourcesMissing: [2],
  lowConfidence: false,
  policyVersion: 1,
  computedAt: 7,
});

/** A badge handle whose lookup the test settles by hand and whose status follows it. */
interface FakeHandle extends BadgeHandle {
  lookups: number;
  settle: () => void;
}

function fakeHandle(): FakeHandle {
  let status: LookupStatus = "idle";
  let settleLookup: () => void = () => undefined;
  const handle: FakeHandle = {
    lookups: 0,
    settle: () => settleLookup(),
    subscribe: () => () => undefined,
    current: () => verdictOf("many"),
    lookup: () => {
      handle.lookups += 1;
      status = "pending";
      return new Promise<void>((resolve) => {
        settleLookup = () => {
          status = "delivered";
          resolve();
        };
      });
    },
    lookupOnSight: async () => undefined,
    lookupStatus: () => status,
  };
  return handle;
}

interface FakeTarget extends HoverCardTarget {
  handle: FakeHandle;
  badgeHost: HTMLElement;
  attached: boolean;
}

function fakeTarget(name: string, tier: VerdictTier = "many"): FakeTarget {
  const element: HTMLElement = document.createElement("article");
  const anchor: HTMLElement = document.createElement("a");
  const badgeHost: HTMLElement = document.createElement("button");
  element.append(anchor, badgeHost);
  document.body.append(element);
  return {
    post: { element, anchor, ref: { platform: "reddit", handle: name } },
    handle: fakeHandle(),
    verdict: verdictOf(tier),
    badgeHost,
    attached: true,
  };
}

interface Harness {
  layer: HoverCardLayer<FakeTarget>;
  targets: FakeTarget[];
  badgeRenders: FakeTarget[];
  recordFeedback: ReturnType<typeof vi.fn>;
  removeFeedback: ReturnType<typeof vi.fn>;
  lookupsOn: { value: boolean };
  showLikelyHuman: { value: boolean };
}

function makeHarness(targets: FakeTarget[]): Harness {
  const badgeRenders: FakeTarget[] = [];
  const lookupsOn = { value: true };
  const showLikelyHuman = { value: true };
  const recordFeedback = vi.fn(async (input: FeedbackInput): Promise<FeedbackEntry> => ({
    ...input,
    id: `feedback-${input.handle}`,
    recordedAt: 1,
  }));
  const removeFeedback = vi.fn(async (): Promise<boolean> => true);
  const layer: HoverCardLayer<FakeTarget> = createHoverCardLayer<FakeTarget>({
    ctx: fakeContext(),
    shadowCss: ":host { --botdar-test: layer; }",
    theme: () => "dark",
    targetAt: (anchor) => targets.find((target) => target.badgeHost === anchor),
    isTargetLive: (target) => target.attached,
    drawableTier: (verdict): BadgeTier | undefined =>
      shouldDrawBadge(verdict.tier, showLikelyHuman.value) ? verdict.tier : undefined,
    cardHandle: (handle) => `u/${handle}`,
    labelStyle: () => "plain",
    lookupsEnabled: () => lookupsOn.value,
    renderBadge: (target) => badgeRenders.push(target),
    recordFeedback,
    removeFeedback,
    openSettings: () => undefined,
  });
  return {
    layer,
    targets,
    badgeRenders,
    recordFeedback,
    removeFeedback,
    lookupsOn,
    showLikelyHuman,
  };
}

const cardHost = (): HTMLElement => {
  const host: HTMLElement | null = document.querySelector(CARD_ELEMENT_NAME);
  if (host === null) throw new Error("card host missing");
  return host;
};
const cardShown = (): boolean => cardHost().style.getPropertyValue("--botdar-display") === "block";
const inCard = (selector: string): Element | null | undefined =>
  cardHost().shadowRoot?.querySelector(selector);

async function open(harness: Harness, target: FakeTarget): Promise<void> {
  harness.layer.controller.requestOpen(target.badgeHost);
  await vi.advanceTimersByTimeAsync(OPEN_DELAY_MS);
}

async function close(harness: Harness): Promise<void> {
  harness.layer.controller.requestClose();
  await vi.advanceTimersByTimeAsync(CLOSE_DELAY_MS);
}

let harness: Harness | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});

afterEach(() => {
  harness?.layer.dispose();
  harness = undefined;
  vi.useRealTimers();
});

describe("createHoverCardLayer", () => {
  it("mounts one hidden card host up front and removes it on dispose", async () => {
    harness = makeHarness([]);
    await harness.layer.ready;
    expect(document.querySelectorAll(CARD_ELEMENT_NAME)).toHaveLength(1);
    expect(cardShown()).toBe(false);

    harness.layer.dispose();
    harness = undefined;
    expect(document.querySelector(CARD_ELEMENT_NAME)).toBeNull();
  });

  it("removes a card host that finishes mounting after dispose", async () => {
    const early: Harness = makeHarness([]);
    early.layer.dispose();
    await early.layer.ready;
    expect(document.querySelector(CARD_ELEMENT_NAME)).toBeNull();
  });

  it("opens for the post at the badge host, in the host's theme, and redraws its badge", async () => {
    const alice: FakeTarget = fakeTarget("alice");
    harness = makeHarness([alice]);
    await harness.layer.ready;

    await open(harness, alice);
    expect(cardShown()).toBe(true);
    expect(cardHost().dataset.theme).toBe("dark");
    expect(inCard(".bd-card__handle")?.textContent).toBe("u/alice");
    expect(inCard(".bd-card")?.id).toBe("botdar-card");
    expect(harness.layer.isOpen(alice)).toBe(true);
    expect(harness.badgeRenders).toContain(alice);

    harness.badgeRenders.length = 0;
    await close(harness);
    expect(cardShown()).toBe(false);
    expect(harness.layer.isOpen(alice)).toBe(false);
    expect(harness.badgeRenders).toEqual([alice]);
  });

  it("opens nothing for an anchor with no post or a verdict the badge rules hide", async () => {
    const human: FakeTarget = fakeTarget("human", "typical");
    harness = makeHarness([human]);
    harness.showLikelyHuman.value = false;
    await harness.layer.ready;

    harness.layer.controller.requestOpen(document.body);
    await vi.advanceTimersByTimeAsync(OPEN_DELAY_MS);
    expect(cardShown()).toBe(false);
    expect(harness.layer.controller.isOpen()).toBe(false);
    await open(harness, human);
    expect(cardShown()).toBe(false);
    expect(harness.layer.controller.isOpen()).toBe(false);
    await close(harness);

    // Nothing opened, so the first real opening still has its intent delay and its legend.
    harness.showLikelyHuman.value = true;
    harness.layer.controller.requestOpen(human.badgeHost);
    await vi.advanceTimersByTimeAsync(OPEN_DELAY_MS - 1);
    expect(cardShown()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(cardShown()).toBe(true);
    expect(inCard(".bd-card__legend")).not.toBeNull();
  });

  it("stays closed for a hover that lands before the card host has mounted", async () => {
    const alice: FakeTarget = fakeTarget("alice");
    harness = makeHarness([alice]);
    harness.layer.controller.requestOpen(alice.badgeHost);
    // Synchronous, so the open timer fires before the mount's promises can settle.
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(harness.layer.controller.isOpen()).toBe(false);
    await harness.layer.ready;

    await open(harness, alice);
    expect(cardShown()).toBe(true);
    expect(inCard(".bd-card__legend")).not.toBeNull();
  });

  it("closes the open card when a redraw finds its verdict no longer drawn", async () => {
    const human: FakeTarget = fakeTarget("human", "typical");
    harness = makeHarness([human]);
    await harness.layer.ready;
    await open(harness, human);
    expect(cardShown()).toBe(true);

    harness.showLikelyHuman.value = false;
    harness.layer.renderCard();
    expect(cardShown()).toBe(false);
    expect(harness.layer.isOpen(human)).toBe(false);
  });

  // The contract X's wiring test pinned first: the legend stays through the first opening, also
  // across the redraw its lookup causes, and no later opening shows it.
  it("shows the source legend through the whole first opening and never after", async () => {
    const alice: FakeTarget = fakeTarget("alice");
    harness = makeHarness([alice]);
    await harness.layer.ready;

    await open(harness, alice);
    expect(inCard(".bd-card__legend")).not.toBeNull();
    alice.handle.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(inCard(".bd-card__title")?.textContent).toBe("Likely bot");
    expect(inCard(".bd-card__legend")).not.toBeNull();

    await close(harness);
    await open(harness, alice);
    expect(cardShown()).toBe(true);
    expect(inCard(".bd-card__legend")).toBeNull();
  });

  it("looks the account up when the card shows, reads Checking until it settles, then redraws", async () => {
    const unknown: FakeTarget = fakeTarget("unknown", "unknown");
    harness = makeHarness([unknown]);
    await harness.layer.ready;

    harness.layer.controller.requestOpen(unknown.badgeHost);
    await vi.advanceTimersByTimeAsync(OPEN_DELAY_MS - 1);
    expect(unknown.handle.lookups).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(unknown.handle.lookups).toBe(1);
    expect(isLookingUp(unknown)).toBe(true);
    expect(inCard(".bd-card__title")?.textContent).toBe("Checking");
    expect(inCard(".bd-card")?.getAttribute("aria-busy")).toBe("true");

    harness.badgeRenders.length = 0;
    unknown.handle.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(isLookingUp(unknown)).toBe(false);
    expect(harness.badgeRenders).toEqual([unknown]);
    expect(inCard(".bd-card__title")?.textContent).toBe("No read");
  });

  it("leaves the badge of a post detached before its lookup settled alone", async () => {
    const alice: FakeTarget = fakeTarget("alice");
    harness = makeHarness([alice]);
    await harness.layer.ready;
    await open(harness, alice);
    await close(harness);

    alice.attached = false;
    harness.badgeRenders.length = 0;
    alice.handle.settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.badgeRenders).toEqual([]);
  });

  it("spends no lookup on a pointer that leaves before the card opens, or while Tier 2 is off", async () => {
    const alice: FakeTarget = fakeTarget("alice");
    harness = makeHarness([alice]);
    await harness.layer.ready;

    harness.layer.controller.requestOpen(alice.badgeHost);
    await vi.advanceTimersByTimeAsync(OPEN_DELAY_MS / 2);
    harness.layer.controller.requestClose();
    await vi.advanceTimersByTimeAsync(OPEN_DELAY_MS * 2);
    expect(cardShown()).toBe(false);

    harness.lookupsOn.value = false;
    await open(harness, alice);
    expect(cardShown()).toBe(true);
    expect(alice.handle.lookups).toBe(0);
  });

  it("offers the report again when storing it fails, and leaves nothing to undo", async () => {
    const alice: FakeTarget = fakeTarget("alice");
    harness = makeHarness([alice]);
    harness.lookupsOn.value = false;
    harness.recordFeedback.mockRejectedValueOnce(new Error("storage quota"));
    await harness.layer.ready;

    await open(harness, alice);
    (inCard(".bd-btn") as HTMLButtonElement).click();
    expect(inCard(".bd-btn--sent")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(inCard(".bd-btn--sent")).toBeNull();
    expect(harness.removeFeedback).not.toHaveBeenCalled();
  });

  it("removes nothing when the report being undone failed to store", async () => {
    const alice: FakeTarget = fakeTarget("alice");
    harness = makeHarness([alice]);
    harness.lookupsOn.value = false;
    let failWrite: (error: Error) => void = () => undefined;
    harness.recordFeedback.mockImplementationOnce(
      () => new Promise<FeedbackEntry>((_resolve, reject) => (failWrite = reject)),
    );
    await harness.layer.ready;

    await open(harness, alice);
    (inCard(".bd-btn") as HTMLButtonElement).click();
    (inCard(".bd-btn--sent") as HTMLButtonElement).click();
    failWrite(new Error("storage quota"));
    await vi.advanceTimersByTimeAsync(0);
    expect(inCard(".bd-btn--sent")).toBeNull();
    expect(harness.removeFeedback).not.toHaveBeenCalled();
  });

  it("keeps feedback per account for the page's lifetime and undoes it with the recorded id", async () => {
    const first: FakeTarget = fakeTarget("alice");
    const second: FakeTarget = fakeTarget("alice");
    harness = makeHarness([first, second]);
    harness.lookupsOn.value = false;
    await harness.layer.ready;

    await open(harness, first);
    (inCard(".bd-btn") as HTMLButtonElement).click();
    expect(inCard(".bd-btn--sent")).not.toBeNull();
    expect(harness.recordFeedback).toHaveBeenCalledWith({
      platform: "reddit",
      handle: "alice",
      tier: "many",
      reasons: ["Joined 2 weeks ago"],
      computedAt: 7,
    });
    await close(harness);

    await open(harness, second);
    expect(inCard(".bd-btn--sent")).not.toBeNull();
    (inCard(".bd-btn--sent") as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(inCard(".bd-btn--sent")).toBeNull();
    expect(harness.removeFeedback).toHaveBeenCalledWith("feedback-alice");
    expect(harness.recordFeedback).toHaveBeenCalledTimes(1);
  });
});
