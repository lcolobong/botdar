/**
 * Post → badge → hover card orchestration for one platform (docs/architecture.md, "Badge and hover
 * card mounting"). Each attached post gets a resolver handle and a badge that is drawn only for the
 * tiers the badge rules allow (docs/design.md); the single hover card follows the badge under the
 * pointer and triggers the Tier 2 lookup on open. Written against PlatformAdapter so Reddit and
 * Bluesky can copy the shape until it is hoisted into src/ui.
 */
import { h, render } from "preact";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { FeedbackEntry, FeedbackInput } from "@/src/core/feedback";
import type { AccountResolver, BadgeHandle } from "@/src/core/pipeline";
import type { Settings } from "@/src/core/settings";
import type { EffectivePlatformConfig, PlatformAdapter, PostRef, Verdict } from "@/src/core/types";
import { Badge, type BadgeProps } from "@/src/ui/Badge";
import { HoverCard, type HoverCardProps } from "@/src/ui/HoverCard";
import { createHoverController, type HoverController } from "@/src/ui/hoverController";
import { shouldDrawBadge, type BadgeTier } from "@/src/ui/labels";
import { kindOfPost, recordBadged } from "@/src/core/diagnostics";
import { detectHostTheme, mountBadge, mountCard, type MountedUi } from "@/src/ui/mount";
import { noReadCardProps } from "@/src/ui/noRead";

export interface WireOptions {
  ctx: ContentScriptContext;
  adapter: PlatformAdapter;
  resolver: AccountResolver;
  /** Shadow-root stylesheet text: `shadowStyles` of the entrypoint's `?inline` imports. */
  shadowCss: string;
  settings: () => Settings;
  config: () => EffectivePlatformConfig;
  /** Platform-owned DOM marks that let later observer passes skip badged posts at selector level. */
  markBadged: (element: Element) => void;
  unmarkBadged: (element: Element) => void;
  recordFeedback: (input: FeedbackInput) => Promise<FeedbackEntry>;
  removeFeedback: (id: string) => Promise<boolean>;
  openSettings: () => void;
  /** Display prefix for the card's handle line, e.g. "@" or "u/". */
  handlePrefix: string;
}

export interface PlatformWiring {
  attach: (post: PostRef) => void;
  release: (element: Element) => void;
  /** Settings or config changed: redraw every badge and the open card. */
  refresh: () => void;
  stop: () => void;
}

interface PostState {
  post: PostRef;
  handle: BadgeHandle;
  verdict: Verdict;
  unsubscribe: () => void;
  badge: MountedUi | undefined;
  badgeContainer: HTMLElement | undefined;
  mounting: boolean;
  released: boolean;
  loading: boolean;
  feedback: FeedbackEntry | undefined;
}

export const CARD_ID = "botdar-card";

export function wirePlatform(options: WireOptions): PlatformWiring {
  const states = new Map<Element, PostState>();
  const stateByBadgeHost = new Map<Element, PostState>();
  let card: MountedUi | undefined;
  let cardContainer: HTMLElement | undefined;
  let openState: PostState | undefined;
  let legendPending = true;
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
      ...(openState === state ? { describedBy: CARD_ID } : {}),
      onOpen: () => state.badge !== undefined && hover.requestOpen(state.badge.shadowHost),
      onClose: () => hover.requestClose(),
    };
  };

  const renderBadge = (state: PostState): void => {
    const tier: BadgeTier | undefined = drawableTier(state.verdict);
    if (state.badgeContainer !== undefined && tier !== undefined) {
      render(h(Badge, badgeProps(state, tier)), state.badgeContainer);
    }
  };

  const unmountBadge = (state: PostState): void => {
    if (openState === state) {
      hover.closeNow();
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
    if (openState === state) {
      renderCard(state);
    }
  };

  // MARK: - Hover card

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
      const state: PostState | undefined = stateByBadgeHost.get(anchor);
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
    if (stopped) {
      mounted.remove();
      return;
    }
    card = mounted;
    mounted.setVisible(false);
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
      hover.dispose();
      for (const element of [...states.keys()]) {
        this.release(element);
      }
      card?.remove();
      card = undefined;
    },
  };
}
