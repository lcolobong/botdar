/**
 * Post → badge → hover card orchestration for one platform (docs/architecture.md, "Badge and hover
 * card mounting"). Each attached post gets a resolver handle and a badge that is drawn only for the
 * tiers the badge rules allow (docs/design.md); the single hover card follows the badge under the
 * pointer and triggers the Tier 2 lookup on open. Written against PlatformAdapter so Reddit and
 * Bluesky can copy the shape until it is hoisted into src/ui.
 */
import { h, render } from "preact";
import type { BadgeHandle } from "@/src/core/pipeline";
import type { Settings } from "@/src/core/settings";
import type { PostRef, Verdict } from "@/src/core/types";
import { Badge, type BadgeProps } from "@/src/ui/Badge";
import { shouldDrawBadge, type BadgeTier } from "@/src/ui/labels";
import { kindOfPost, recordBadged } from "@/src/core/diagnostics";
import { detectHostTheme, mountBadge } from "@/src/ui/mount";
import { CARD_ID, createHoverCardLayer, type HoverCardLayer } from "./hoverCard";
import type { PlatformWiring, PostState, WireOptions } from "./wireTypes";

export type { PlatformWiring, WireOptions } from "./wireTypes";

export { CARD_ID } from "./hoverCard";

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
      loading: state.loading,
      glyphOnlyAtCommentDensity: settings.redditCommentLabels === "glyph",
      ...(cardLayer.isOpen(state) ? { describedBy: CARD_ID } : {}),
      onOpen: () =>
        state.badge !== undefined && cardLayer.hover.requestOpen(state.badge.shadowHost),
      onClose: () => cardLayer.hover.requestClose(),
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
      cardLayer.hover.closeNow();
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
      cardLayer.renderCard(state);
    }
  };

  // MARK: - Hover card

  const cardLayer: HoverCardLayer = createHoverCardLayer({
    options,
    theme,
    badgeStateAt: (anchor) => stateByBadgeHost.get(anchor),
    renderBadge,
    drawableTier,
    isStopped: () => stopped,
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
        feedback: undefined,
        mounting: false,
        released: false,
        loading: false,
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
      cardLayer.hover.dispose();
      for (const element of [...states.keys()]) {
        this.release(element);
      }
      cardLayer.removeCard();
    },
  };
}
