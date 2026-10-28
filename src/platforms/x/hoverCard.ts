import { h, render } from "preact";
import type { Verdict } from "@/src/core/types";
import { HoverCard, type HoverCardProps } from "@/src/ui/HoverCard";
import { createHoverController, type HoverController } from "@/src/ui/hoverController";
import type { BadgeTier } from "@/src/ui/labels";
import { mountCard, type HostTheme, type MountedUi } from "@/src/ui/mount";
import { noReadCardProps } from "@/src/ui/noRead";
import type { PostState, WireOptions } from "./wireTypes";

export const CARD_ID = "botdar-card";

/**
 * What the hover card needs from the badge side of the wiring, passed in once so the card code owns
 * its state (which post is open, the mounted card, the one-time legend) without reaching into the
 * badge closures.
 */
export interface HoverCardContext {
  options: WireOptions;
  theme: () => HostTheme;
  /** The post whose badge host is `anchor`, if a badge is currently mounted there. */
  badgeStateAt: (anchor: Element) => PostState | undefined;
  renderBadge: (state: PostState) => void;
  drawableTier: (verdict: Verdict) => BadgeTier | undefined;
  isStopped: () => boolean;
}

export interface HoverCardLayer {
  hover: HoverController;
  /** Whether the card is currently open for this post. */
  isOpen: (state: PostState) => boolean;
  renderCard: (state: PostState) => void;
  removeCard: () => void;
}

export function createHoverCardLayer(context: HoverCardContext): HoverCardLayer {
  const { options, theme, badgeStateAt, renderBadge, drawableTier, isStopped } = context;
  let card: MountedUi | undefined;
  let cardContainer: HTMLElement | undefined;
  let openState: PostState | undefined;
  let legendPending = true;

  const cardProps = (state: PostState, tier: BadgeTier): HoverCardProps => ({
    id: CARD_ID,
    opening: hover.openings(),
    tier,
    labelStyle: options.settings().labelStyle,
    handle: `${options.handlePrefix}${state.post.ref.handle}`,
    reasons: state.verdict.reasons,
    ...(state.verdict.confidenceNote === undefined
      ? {}
      : { confidenceNote: state.verdict.confidenceNote }),
    caveat: state.verdict.caveat,
    ...noReadCardProps(state.verdict, state.handle),
    loading: state.loading,
    lowConfidence: state.verdict.lowConfidence,
    showLegend: legendPending,
    feedbackSent: state.feedback !== undefined,
    onFeedback: () => void toggleFeedback(state),
    onSettings: options.openSettings,
  });

  const renderCard = (state: PostState): void => {
    const tier: BadgeTier | undefined = drawableTier(state.verdict);
    if (cardContainer === undefined || tier === undefined) {
      return;
    }
    render(h(HoverCard, cardProps(state, tier)), cardContainer);
  };

  const toggleFeedback = async (state: PostState): Promise<void> => {
    if (state.feedback !== undefined) {
      await options.removeFeedback(state.feedback.id);
      state.feedback = undefined;
    } else {
      const { platform, handle } = state.post.ref;
      const { tier, reasons, computedAt } = state.verdict;
      state.feedback = await options.recordFeedback({
        platform,
        handle,
        tier,
        reasons: reasons.map((reason) => reason.text),
        computedAt,
      });
    }
    if (openState === state) {
      renderCard(state);
    }
  };

  const lookupWhileOpen = (state: PostState): void => {
    if (!options.config().tiers.t2 || state.loading) {
      return;
    }
    // The hover's render pass draws the badge and card right after this, already loading.
    state.loading = true;
    void state.handle.lookup().finally(() => {
      state.loading = false;
      renderBadge(state);
      if (openState === state) {
        renderCard(state);
      }
    });
  };

  const hover: HoverController = createHoverController({
    render: (anchor) => {
      const state: PostState | undefined = badgeStateAt(anchor);
      if (state === undefined || card === undefined) {
        return 0;
      }
      openState = state;
      card.setTheme(theme());
      card.setVisible(true);
      // The lookup starts first so the card's first render already shows its checking state.
      lookupWhileOpen(state);
      renderCard(state);
      renderBadge(state);
      return cardContainer?.getBoundingClientRect().height ?? 0;
    },
    place: (placement) => {
      if (card !== undefined) {
        card.setPlacement(placement);
        card.setVisible(true);
      }
    },
    hide: () => {
      const wasOpen: PostState | undefined = openState;
      openState = undefined;
      legendPending = false;
      if (card !== undefined) {
        card.setVisible(false);
      }
      if (wasOpen !== undefined) {
        renderBadge(wasOpen);
      }
    },
  });

  // The card host is mounted once, hidden, so opening it later never waits on an async mount.
  void mountCard(
    options.ctx,
    (container) => {
      cardContainer = container;
      const unbindCard: () => void = hover.bindCard(container);
      return () => {
        unbindCard();
        render(null, container);
      };
    },
    theme(),
    options.shadowCss,
  ).then((mounted) => {
    if (isStopped()) {
      mounted.remove();
      return;
    }
    card = mounted;
    mounted.setVisible(false);
  });

  return {
    hover,
    isOpen: (state) => openState === state,
    renderCard,
    removeCard: () => {
      card?.remove();
      card = undefined;
    },
  };
}
