/**
 * The page's single hover card, shared by every platform's wiring (docs/architecture.md, "Badge and
 * hover card mounting"): the card host, mounted once and hidden between openings; the hover
 * controller that opens, places and hides it; the Tier 2 lookup an opening starts; the one-time
 * source legend; the per-account feedback toggle; and the card's render. What differs by platform
 * comes in through HoverCardLayerContext: how a badge host resolves to its post, which tiers the
 * badge rules draw, how the card names the account, the host's theme and the badge redraw.
 */
import { h, render } from "preact";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { FeedbackEntry, FeedbackInput } from "@/src/core/feedback";
import type { BadgeHandle } from "@/src/core/pipeline";
import type { LabelStyle } from "@/src/core/settings";
import type { PostRef, Verdict } from "@/src/core/types";
import { HoverCard } from "./HoverCard";
import type { HoverCardProps } from "./HoverCard";
import { createHoverController } from "./hoverController";
import type { HoverController } from "./hoverController";
import type { BadgeTier } from "./labels";
import { CARD_ID, mountCard } from "./mount";
import type { HostTheme, MountedUi } from "./mount";
import { noReadCardProps } from "./noRead";

/** What the card reads from a platform's per-post state; each wire's state type carries these. */
export interface HoverCardTarget {
  post: PostRef;
  handle: BadgeHandle;
  verdict: Verdict;
}

/**
 * Whether the target's account has a Tier 2 lookup in flight, queued on sight or run by a hover.
 * The badge and the card both show it, and every post by the account shares it.
 */
export function isLookingUp(target: Pick<HoverCardTarget, "handle">): boolean {
  return target.handle.lookupStatus() === "pending";
}

export interface HoverCardLayerContext<Target extends HoverCardTarget> {
  ctx: ContentScriptContext;
  /** Shadow-root stylesheet text: `shadowStyles` of the entrypoint's `?inline` imports. */
  shadowCss: string;
  theme: () => HostTheme;
  /** The post whose badge host is `anchor`, if a badge has mounted there. */
  targetAt: (anchor: Element) => Target | undefined;
  /**
   * Whether the post is still attached. A lookup can settle, or the card close, after the feed
   * dropped the post, and its badge must then not be redrawn (or mounted again).
   */
  isTargetLive: (target: Target) => boolean;
  /** The tier the badge rules draw for this verdict, or undefined when they hide it. */
  drawableTier: (verdict: Verdict) => BadgeTier | undefined;
  /** How the card names the account, such as "@name" or "u/name". */
  cardHandle: (handle: string) => string;
  labelStyle: () => LabelStyle;
  /** Whether Tier 2 is on, so an opening may look the account up. */
  lookupsEnabled: () => boolean;
  /** The card opened or closed for this post, or its lookup settled: its badge should redraw. */
  renderBadge: (target: Target) => void;
  recordFeedback: (input: FeedbackInput) => Promise<FeedbackEntry>;
  removeFeedback: (id: string) => Promise<boolean>;
  openSettings: () => void;
}

export interface HoverCardLayer<Target extends HoverCardTarget> {
  /** The badges call requestOpen and requestClose on it; a badge unmounting calls closeNow. */
  controller: HoverController;
  /** Settles once the card host has mounted; a hover before then opens nothing and stays closed. */
  ready: Promise<void>;
  isOpen: (target: Target) => boolean;
  /** Redraws the card for the post it is open for; does nothing while it is closed. */
  renderCard: () => void;
  /** Stops the controller and removes the card host, also one still mounting. */
  dispose: () => void;
}

export function createHoverCardLayer<Target extends HoverCardTarget>(
  context: HoverCardLayerContext<Target>,
): HoverCardLayer<Target> {
  let card: MountedUi | undefined;
  let cardContainer: HTMLElement | undefined;
  let openTarget: Target | undefined;
  let disposed = false;
  // Cleared when the first opening closes, not after its first render: the open pass renders
  // again in the same task when a lookup starts, which would drop the legend before it is painted.
  let legendPending = true;
  // Feedback is about the account, so it is kept per handle for the page's lifetime: a second post
  // by the same author, or the same post scrolled away and back, shows it as sent.
  const feedbackByHandle = new Map<string, Promise<FeedbackEntry>>();

  // MARK: - Card

  const cardProps = (target: Target, tier: BadgeTier): HoverCardProps => {
    const verdict: Verdict = target.verdict;
    return {
      id: CARD_ID,
      opening: controller.openings(),
      tier,
      labelStyle: context.labelStyle(),
      handle: context.cardHandle(target.post.ref.handle),
      reasons: verdict.reasons,
      ...(verdict.confidenceNote === undefined ? {} : { confidenceNote: verdict.confidenceNote }),
      caveat: verdict.caveat,
      ...noReadCardProps(verdict, target.handle),
      loading: isLookingUp(target),
      lowConfidence: verdict.lowConfidence,
      showLegend: legendPending,
      feedbackSent: feedbackByHandle.has(target.post.ref.handle),
      onFeedback: () => toggleFeedback(target),
      onSettings: context.openSettings,
    };
  };

  function renderCard(): void {
    const target: Target | undefined = openTarget;
    if (target === undefined || cardContainer === undefined) return;
    const tier: BadgeTier | undefined = context.drawableTier(target.verdict);
    // A verdict the badge rules stopped drawing (Likely human turned off) closes the card. The
    // badge usually unmounts first and closes it; this covers a redraw that comes before that.
    if (tier === undefined) {
      controller.closeNow();
      return;
    }
    render(h(HoverCard, cardProps(target, tier)), cardContainer);
  }

  // MARK: - Actions

  // The sent state flips at once and the storage write follows; an undo waits on the write it removes.
  function toggleFeedback(target: Target): void {
    const { platform, handle } = target.post.ref;
    const pending: Promise<FeedbackEntry> | undefined = feedbackByHandle.get(handle);
    if (pending !== undefined) {
      feedbackByHandle.delete(handle);
      // A write that failed stored nothing, so there is nothing to remove.
      void pending.then(
        (entry) => context.removeFeedback(entry.id),
        () => undefined,
      );
    } else {
      const { tier, reasons, computedAt } = target.verdict;
      const recording: Promise<FeedbackEntry> = context.recordFeedback({
        platform,
        handle,
        tier,
        reasons: reasons.map((reason) => reason.text),
        computedAt,
      });
      feedbackByHandle.set(handle, recording);
      // A write that failed was never sent: the card offers the report again.
      recording.catch(() => {
        if (feedbackByHandle.get(handle) !== recording) return;
        feedbackByHandle.delete(handle);
        renderCard();
      });
    }
    renderCard();
  }

  /**
   * Every opening asks, once the card shows rather than when the pointer reaches the badge, so a
   * pointer passing over a badge spends no request. It is often a cache hit (an on-sight platform
   * looked the author up already); an author still queued on sight moves to the queue's front, and
   * a lookup already running for the account is shared rather than repeated. The closing rescore
   * redraws the badge and card; the redraw here covers a lookup that settles without one.
   */
  function lookupOnOpen(target: Target): void {
    if (!context.lookupsEnabled()) return;
    void target.handle.lookup().finally(() => {
      if (!context.isTargetLive(target)) return;
      context.renderBadge(target);
      if (openTarget === target) renderCard();
    });
  }

  // MARK: - Controller

  const controller: HoverController = createHoverController({
    // Undefined, not a zero height, when nothing shows: the controller then stays closed, so no
    // hide uses up the legend and the next hover waits out the intent delay again.
    render: (anchor) => {
      const target: Target | undefined = context.targetAt(anchor);
      if (target === undefined || card === undefined) return undefined;
      if (context.drawableTier(target.verdict) === undefined) return undefined;
      openTarget = target;
      card.setTheme(context.theme());
      card.setVisible(true);
      // Started before the first render, so the card opens already showing its checking state.
      lookupOnOpen(target);
      renderCard();
      context.renderBadge(target);
      return cardContainer?.getBoundingClientRect().height ?? 0;
    },
    place: (placement) => {
      card?.setPlacement(placement);
    },
    hide: () => {
      const closedTarget: Target | undefined = openTarget;
      openTarget = undefined;
      card?.setVisible(false);
      if (closedTarget === undefined) return;
      // Only an opening that showed a card used up the legend.
      legendPending = false;
      if (context.isTargetLive(closedTarget)) context.renderBadge(closedTarget);
    },
  });

  // MARK: - Mount

  // Mounted once, hidden, so opening the card later never waits on an async mount.
  const ready: Promise<void> = mountCard(
    context.ctx,
    (container) => {
      cardContainer = container;
      const unbindCard: () => void = controller.bindCard(container);
      return () => {
        unbindCard();
        render(null, container);
        cardContainer = undefined;
      };
    },
    context.theme(),
    context.shadowCss,
  ).then((mounted) => {
    if (disposed) {
      mounted.remove();
      return;
    }
    card = mounted;
    mounted.setVisible(false);
  });

  return {
    controller,
    ready,
    isOpen: (target) => openTarget === target,
    renderCard,
    dispose: () => {
      disposed = true;
      controller.dispose();
      card?.remove();
      card = undefined;
    },
  };
}
