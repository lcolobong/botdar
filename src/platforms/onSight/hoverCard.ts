/**
 * The on-sight wiring's single hover card: which badge it is open for, the one-time legend, the
 * feedback toggle, and the hover controller that opens, places and hides it. The card is mounted
 * before any badge exists, so the badge side is bound to it afterwards through bindBadges; until
 * then no badge can be hovered and the card has nothing to open for.
 */
import { h, render } from "preact";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { FeedbackEntry } from "@/src/core/feedback";
import { recordFeedback, removeFeedback } from "@/src/core/feedback";
import type { Verdict } from "@/src/core/types";
import { HoverCard } from "@/src/ui/HoverCard";
import type { HoverController } from "@/src/ui/hoverController";
import { createHoverController } from "@/src/ui/hoverController";
import type { HostTheme, MountedUi } from "@/src/ui/mount";
import { mountCard } from "@/src/ui/mount";
import { noReadCardProps } from "@/src/ui/noRead";
import type { BadgeSlot, OnSightPlatform, OnSightRuntime } from "./types";

export const CARD_ID = "botdar-card";

/** What the card needs from the rest of the wiring when it mounts. */
export interface OnSightCardContext {
  ctx: ContentScriptContext;
  shadowCss: string;
  platform: OnSightPlatform;
  runtime: () => OnSightRuntime;
  theme: () => HostTheme;
  openSettings: () => void;
}

/** What the card reads from the badge side once the badges exist. */
export interface CardBadges {
  /** The slot whose badge host is `host`, if a badge has mounted there. */
  slotAtHost: (host: Element) => BadgeSlot | undefined;
  renderBadge: (slot: BadgeSlot) => void;
}

export interface OnSightCard {
  controller: HoverController;
  isOpen: (slot: BadgeSlot) => boolean;
  /** Redraws the card for the slot it is open for; does nothing while it is closed. */
  renderCard: () => void;
  bindBadges: (badges: CardBadges) => void;
  remove: () => void;
}

/** Whether the slot's author has a Tier 2 lookup in flight; the badge and the card both show it. */
export function isLookingUp(slot: BadgeSlot): boolean {
  return slot.handle.lookupStatus() === "pending";
}

export async function mountOnSightCard(context: OnSightCardContext): Promise<OnSightCard> {
  const { ctx, shadowCss, platform, runtime, theme, openSettings } = context;
  const feedbackByHandle = new Map<string, Promise<FeedbackEntry>>();
  let badges: CardBadges | undefined = undefined;
  let openSlot: BadgeSlot | null = null;
  let legendShown = false;
  let cardContainer: HTMLElement | null = null;

  // Set once the card has mounted. The controller is created before that, so the mount callback
  // can bind the card's container to it, and its callbacks guard for a card not mounted yet.
  let card: MountedUi | undefined = undefined;
  const controller: HoverController = createHoverController({
    render: (host) => {
      const slot: BadgeSlot | undefined = badges?.slotAtHost(host);
      if (slot === undefined || card === undefined) return 0;
      openSlot = slot;
      renderCard();
      legendShown = true;
      card.setTheme(theme());
      card.setVisible(true);
      if (runtime().config.tiers.t2) {
        // Usually a cache hit: the author was looked up on sight. An author still waiting in the
        // on-sight queue moves to its front (the resolver promotes it), and one already running
        // shares that lookup. The closing rescore redraws the badge and the card.
        void slot.handle.lookup();
        badges?.renderBadge(slot);
        renderCard();
      }
      return cardContainer?.getBoundingClientRect().height ?? 0;
    },
    hide: () => {
      const closedSlot: BadgeSlot | null = openSlot;
      openSlot = null;
      card?.setVisible(false);
      if (closedSlot !== null) badges?.renderBadge(closedSlot);
    },
    place: ({ top, left }) => {
      card?.setPlacement({ top, left });
    },
  });

  const mountedCard: MountedUi = await mountCard(
    ctx,
    (container) => {
      cardContainer = container;
      const unbindCard: () => void = controller.bindCard(container);
      return () => {
        unbindCard();
        render(null, container);
      };
    },
    theme(),
    shadowCss,
  );
  card = mountedCard;
  mountedCard.setVisible(false);

  // Function declarations, so the controller's callbacks above never read a binding declared later.
  function toggleFeedback(slot: BadgeSlot): void {
    const handle: string = slot.post.ref.handle;
    const pending: Promise<FeedbackEntry> | undefined = feedbackByHandle.get(handle);
    if (pending !== undefined) {
      feedbackByHandle.delete(handle);
      void pending.then((entry) => removeFeedback(entry.id));
    } else {
      const { tier, reasons, computedAt } = slot.verdict;
      feedbackByHandle.set(
        handle,
        recordFeedback({
          platform: platform.platform,
          handle,
          tier,
          reasons: reasons.map((reason) => reason.text),
          computedAt,
        }),
      );
    }
    renderCard();
  }

  function renderCard(): void {
    const slot: BadgeSlot | null = openSlot;
    if (slot === null || cardContainer === null) return;
    const verdict: Verdict = slot.verdict;
    // No tier hides an open card any more: a badge that stops being drawn (Likely human turned
    // off) is unmounted, and unmountBadge closes the card first.
    render(
      h(HoverCard, {
        id: CARD_ID,
        opening: controller.openings(),
        tier: verdict.tier,
        labelStyle: runtime().settings.labelStyle,
        handle: platform.cardHandle(slot.post.ref.handle),
        reasons: verdict.reasons,
        ...(verdict.confidenceNote === undefined ? {} : { confidenceNote: verdict.confidenceNote }),
        caveat: verdict.caveat,
        ...noReadCardProps(verdict, slot.handle),
        loading: isLookingUp(slot),
        lowConfidence: verdict.lowConfidence,
        showLegend: !legendShown,
        feedbackSent: feedbackByHandle.has(slot.post.ref.handle),
        onFeedback: () => toggleFeedback(slot),
        onSettings: openSettings,
      }),
      cardContainer,
    );
  }

  return {
    controller,
    isOpen: (slot) => openSlot === slot,
    renderCard,
    bindBadges: (bound) => {
      badges = bound;
    },
    remove: () => mountedCard.remove(),
  };
}
