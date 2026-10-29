/**
 * Post → badge → hover card orchestration for one platform (docs/architecture.md, "Badge and hover
 * card mounting"). Each attached post gets a resolver handle and a badge that is drawn only for the
 * tiers the badge rules allow (docs/design.md); the single hover card follows the badge under the
 * pointer and triggers the Tier 2 lookup on open. The card is the shared layer in
 * src/ui/hoverCardLayer.ts, given X's badge states, badge rules and "@" handles.
 */
import { h, render } from "preact";
import type { BadgeHandle } from "@/src/core/pipeline";
import type { Settings } from "@/src/core/settings";
import type { PostRef, Verdict } from "@/src/core/types";
import { Badge, type BadgeProps } from "@/src/ui/Badge";
import { shouldDrawBadge, type BadgeTier } from "@/src/ui/labels";
import { kindOfPost, recordBadged } from "@/src/core/diagnostics";
import { createHoverCardLayer, isLookingUp, type HoverCardLayer } from "@/src/ui/hoverCardLayer";
import { CARD_ID, detectHostTheme, mountBadge } from "@/src/ui/mount";
import type { PlatformWiring, PostState, WireOptions } from "./wireTypes";

export type { PlatformWiring, WireOptions } from "./wireTypes";

export function wirePlatform(options: WireOptions): PlatformWiring {
  const states = new Map<Element, PostState>();
  const stateByBadgeHost = new Map<Element, PostState>();
  let stopped = false;

  const theme = () => detectHostTheme(options.adapter.id);

  const drawableTier = (verdict: Verdict): BadgeTier | undefined =>
    options.config().enabled && shouldDrawBadge(verdict.tier, options.settings().showLikelyHuman)
      ? verdict.tier
      : undefined;

  // MARK: - Badge

  const badgeProps = (state: PostState, tier: BadgeTier): BadgeProps => {
    const settings: Settings = options.settings();
    return {
      tier,
      labelStyle: settings.labelStyle,
      density: options.adapter.badgeDensity,
      lowConfidence: state.verdict.lowConfidence,
      paused: !options.config().tiers.t2,
      // The account's lookup status, not this post's: one lookup serves every post by the author.
      loading: isLookingUp(state),
      glyphOnlyAtCommentDensity: settings.redditCommentLabels === "glyph",
      ...(cardLayer.isOpen(state) ? { describedBy: CARD_ID } : {}),
      onOpen: () =>
        state.badge !== undefined && cardLayer.controller.requestOpen(state.badge.shadowHost),
      onClose: () => cardLayer.controller.requestClose(),
    };
  };

  const renderBadge = (state: PostState): void => {
    const tier: BadgeTier | undefined = drawableTier(state.verdict);
    if (state.badgeContainer !== undefined && tier !== undefined) {
      render(h(Badge, badgeProps(state, tier)), state.badgeContainer);
    }
  };

  const unmountBadge = (state: PostState): void => {
    if (cardLayer.isOpen(state)) {
      cardLayer.controller.closeNow();
    }
    if (state.badge === undefined) {
      return;
    }
    stateByBadgeHost.delete(state.badge.shadowHost);
    state.badge.remove();
    state.badge = undefined;
    state.badgeContainer = undefined;
    options.unmarkBadged(state.post.element);
  };

  const mountBadgeFor = (state: PostState): void => {
    state.mounting = true;
    mountBadge(
      options.ctx,
      state.post.anchor,
      (container) => {
        state.badgeContainer = container;
        renderBadge(state);
        return () => render(null, container);
      },
      theme(),
      options.shadowCss,
    ).then(
      (mounted) => {
        state.mounting = false;
        if (state.released || stopped || drawableTier(state.verdict) === undefined) {
          mounted.remove();
          return;
        }
        state.badge = mounted;
        stateByBadgeHost.set(mounted.shadowHost, state);
        options.markBadged(state.post.element);
        recordBadged(kindOfPost(state.post), state.post.element);
        renderBadge(state);
      },
      () => {
        state.mounting = false;
      },
    );
  };

  /** Draws, redraws or removes the badge to match the current verdict and settings. */
  const sync = (state: PostState): void => {
    if (drawableTier(state.verdict) === undefined) {
      unmountBadge(state);
    } else if (state.badge !== undefined) {
      renderBadge(state);
    } else if (!state.mounting) {
      mountBadgeFor(state);
    }
    if (cardLayer.isOpen(state)) {
      cardLayer.renderCard();
    }
  };

  // MARK: - Hover card

  const cardLayer: HoverCardLayer<PostState> = createHoverCardLayer<PostState>({
    ctx: options.ctx,
    shadowCss: options.shadowCss,
    theme,
    targetAt: (anchor) => stateByBadgeHost.get(anchor),
    isTargetLive: (state) => !state.released,
    drawableTier,
    cardHandle: (handle) => `${options.handlePrefix}${handle}`,
    labelStyle: () => options.settings().labelStyle,
    lookupsEnabled: () => options.config().tiers.t2,
    renderBadge,
    recordFeedback: options.recordFeedback,
    removeFeedback: options.removeFeedback,
    openSettings: options.openSettings,
  });

  // MARK: - Wiring

  return {
    attach(post: PostRef): void {
      if (stopped || states.has(post.element)) {
        return;
      }
      const handle: BadgeHandle = options.resolver.attach(post);
      const state: PostState = {
        post,
        handle,
        verdict: handle.current(),
        unsubscribe: () => undefined,
        badge: undefined,
        badgeContainer: undefined,
        mounting: false,
        released: false,
      };
      state.unsubscribe = handle.subscribe((verdict) => {
        state.verdict = verdict;
        sync(state);
      });
      states.set(post.element, state);
      sync(state);
    },
    release(element: Element): void {
      const state: PostState | undefined = states.get(element);
      if (state === undefined) {
        return;
      }
      state.released = true;
      state.unsubscribe();
      unmountBadge(state);
      options.resolver.detach(state.post);
      states.delete(element);
    },
    refresh(): void {
      for (const state of states.values()) {
        sync(state);
      }
    },
    stop(): void {
      stopped = true;
      cardLayer.dispose();
      for (const element of [...states.keys()]) {
        this.release(element);
      }
    },
  };
}
