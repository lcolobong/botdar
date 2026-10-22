/**
 * The single hover card for the Bluesky feed: mounted once on the body, driven by the shared hover
 * controller, and rendered from whichever badge the pointer is on. Opening the card is what
 * triggers the Tier 2 lookup, so the card owns the loading state and tells the badge to redraw.
 */
import { h, render } from "preact";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { FeedbackEntry, FeedbackInput } from "../../core/feedback";
import type { BadgeHandle } from "../../core/pipeline";
import type { LabelStyle } from "../../core/settings";
import type { PostRef, SourceTier, Verdict } from "../../core/types";
import { HoverCard } from "../../ui/HoverCard";
import type { CardReason, HoverCardProps } from "../../ui/HoverCard";
import { createHoverController } from "../../ui/hoverController";
import type { HoverCardPlacement, HoverController } from "../../ui/hoverController";
import { shouldDrawBadge } from "../../ui/labels";
import { mountCard } from "../../ui/mount";
import type { HostTheme, MountedUi } from "../../ui/mount";

export const CARD_ID = "botdar-card";

export interface CardTarget {
  post: PostRef;
  handle: BadgeHandle;
  /** The badge's shadow host, which the card is placed against. */
  anchor: Element;
}

export interface CardPresenterOptions {
  ctx: ContentScriptContext;
  theme: () => HostTheme;
  /** Shadow-root stylesheet text: `shadowStyles` of the entrypoint's `?inline` imports. */
  shadowCss: string;
  labelStyle: () => LabelStyle;
  showLikelyHuman: () => boolean;
  lookupsEnabled: () => boolean;
  recordFeedback: (input: FeedbackInput) => Promise<FeedbackEntry>;
  removeFeedback: (id: string) => Promise<boolean>;
  openOptionsPage: () => void;
  /** The card's loading or open state changed for this post, so its badge should redraw. */
  onBadgeStateChange: (element: Element) => void;
}

export interface CardPresenter {
  open: (target: CardTarget) => void;
  requestClose: () => void;
  closeNow: () => void;
  isOpenFor: (element: Element) => boolean;
  isLoadingFor: (element: Element) => boolean;
  /** Re-renders when the verdict, settings or config behind an open card changed. */
  refresh: () => void;
  dispose: () => void;
}

/** Selected reasons with their source tier; a reason without evidence (declared) takes the highest delivered tier. */
export function cardReasons(verdict: Verdict): CardReason[] {
  const tierByReason = new Map<string, SourceTier>(
    verdict.evidence.map((item) => [item.reason, item.tier]),
  );
  const fallbackTier: SourceTier = verdict.sourcesUsed.reduce<SourceTier>(
    (highest, tier) => (tier > highest ? tier : highest),
    0,
  );
  return verdict.reasons.map((text) => ({ text, tier: tierByReason.get(text) ?? fallbackTier }));
}

export function createCardPresenter(options: CardPresenterOptions): CardPresenter {
  const feedbackIdByHandle = new Map<string, string>();
  let current: CardTarget | undefined;
  let container: HTMLElement | undefined;
  let card: MountedUi | undefined;
  let lookupPending = false;
  let legendShown = false;
  /** The post whose card is on screen; the controller only knows once its show pass has returned. */
  let shownFor: Element | undefined;

  const notifyBadge = (): void => {
    if (current !== undefined) {
      options.onBadgeStateChange(current.post.element);
    }
  };

  const toggleFeedback = async (target: CardTarget, verdict: Verdict): Promise<void> => {
    const handle: string = target.post.ref.handle;
    const existingId: string | undefined = feedbackIdByHandle.get(handle);
    if (existingId !== undefined) {
      feedbackIdByHandle.delete(handle);
      await options.removeFeedback(existingId);
    } else {
      const entry: FeedbackEntry = await options.recordFeedback({
        platform: "bluesky",
        handle,
        tier: verdict.tier,
        reasons: verdict.reasons,
        computedAt: verdict.computedAt,
      });
      feedbackIdByHandle.set(handle, entry.id);
    }
    renderCurrent();
  };

  const renderCurrent = (): void => {
    if (current === undefined || container === undefined) {
      return;
    }
    const target: CardTarget = current;
    const verdict: Verdict = target.handle.current();
    if (!shouldDrawBadge(verdict.tier, options.showLikelyHuman())) {
      controller.closeNow();
      return;
    }
    const props: HoverCardProps = {
      id: CARD_ID,
      tier: verdict.tier,
      labelStyle: options.labelStyle(),
      handle: `@${target.post.ref.handle}`,
      reasons: cardReasons(verdict),
      ...(verdict.confidenceNote === undefined ? {} : { confidenceNote: verdict.confidenceNote }),
      caveat: verdict.caveat,
      loading: lookupPending,
      lowConfidence: verdict.lowConfidence,
      showLegend: !legendShown,
      feedbackSent: feedbackIdByHandle.has(target.post.ref.handle),
      onFeedback: () => void toggleFeedback(target, verdict),
      onSettings: options.openOptionsPage,
    };
    render(h(HoverCard, props), container);
  };

  const controller: HoverController = createHoverController({
    render: (): number => {
      shownFor = current?.post.element;
      renderCurrent();
      legendShown = true;
      if (card !== undefined) {
        card.setTheme(options.theme());
        card.setVisible(true);
      }
      notifyBadge();
      return container?.getBoundingClientRect().height ?? 0;
    },
    place: (placement: HoverCardPlacement): void => {
      if (card === undefined) {
        return;
      }
      card.setPlacement(placement);
    },
    hide: (): void => {
      if (card !== undefined) {
        card.setVisible(false);
      }
      shownFor = undefined;
      notifyBadge();
      current = undefined;
    },
  });

  const ensureCard = (): Promise<MountedUi> =>
    mountCard(
      options.ctx,
      (mountedContainer: HTMLElement): (() => void) => {
        container = mountedContainer;
        mountedContainer.addEventListener("mouseenter", controller.holdOpen);
        mountedContainer.addEventListener("mouseleave", controller.requestClose);
        return () => {
          render(null, mountedContainer);
          container = undefined;
        };
      },
      options.theme(),
      options.shadowCss,
    );

  const startLookup = (target: CardTarget): void => {
    if (!options.lookupsEnabled() || lookupPending) {
      return;
    }
    lookupPending = true;
    notifyBadge();
    void target.handle.lookup().finally(() => {
      lookupPending = false;
      renderCurrent();
      notifyBadge();
    });
  };

  return {
    open: (target: CardTarget): void => {
      current = target;
      void ensureCard().then((mounted: MountedUi) => {
        card = mounted;
        if (current !== target) {
          return;
        }
        controller.requestOpen(target.anchor);
        startLookup(target);
      });
    },
    requestClose: (): void => {
      // A pointer that left before the card mounted must not open it afterwards.
      if (shownFor === undefined) {
        current = undefined;
      }
      controller.requestClose();
    },
    closeNow: controller.closeNow,
    isOpenFor: (element: Element): boolean => shownFor === element,
    isLoadingFor: (element: Element): boolean => lookupPending && current?.post.element === element,
    refresh: renderCurrent,
    dispose: (): void => {
      controller.dispose();
      card?.remove();
      card = undefined;
    },
  };
}
