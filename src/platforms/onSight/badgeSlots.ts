/**
 * One badge slot per discovered post. Attaching a post subscribes it to the resolver and mounts its
 * badge; every new verdict or runtime change syncs the badge, which redraws, mounts or unmounts it
 * by the badge rules (docs/design.md); detaching releases the post and its badge.
 */
import { h, render } from "preact";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { BADGED_ATTRIBUTE } from "@/src/core/botdarMarks";
import { kindOfPost, recordBadged } from "@/src/core/diagnostics";
import type { AccountResolver, BadgeHandle } from "@/src/core/pipeline";
import type { PlatformAdapter, PostRef } from "@/src/core/types";
import { Badge } from "@/src/ui/Badge";
import { isLookingUp } from "@/src/ui/hoverCardLayer";
import type { HoverCardLayer } from "@/src/ui/hoverCardLayer";
import { shouldDrawBadge } from "@/src/ui/labels";
import type { HostTheme } from "@/src/ui/mount";
import { mountBadge } from "@/src/ui/mount";
import type { BadgeSlot, OnSightRuntime } from "./types";

export interface BadgeSlotsContext {
  ctx: ContentScriptContext;
  shadowCss: string;
  adapter: PlatformAdapter;
  resolver: AccountResolver;
  runtime: () => OnSightRuntime;
  theme: () => HostTheme;
  /** The parts of the hover card a badge opens, closes and redraws. */
  card: Pick<HoverCardLayer<BadgeSlot>, "controller" | "isOpen" | "renderCard">;
  /** Look an author up as their post is attached (ADR-0020), or leave it to the hover (ADR-0030). */
  looksUpOnSight: boolean;
}

export interface BadgeSlots {
  attachPost: (post: PostRef) => void;
  detachElement: (element: Element) => void;
  detachAll: () => void;
  syncBadge: (slot: BadgeSlot) => void;
  renderBadge: (slot: BadgeSlot) => void;
  /** The slot whose badge host is `host`, if a badge has mounted there. */
  slotAtHost: (host: Element) => BadgeSlot | undefined;
  all: () => Iterable<BadgeSlot>;
}

export function createBadgeSlots(context: BadgeSlotsContext): BadgeSlots {
  const { ctx, shadowCss, adapter, resolver, runtime, theme, card, looksUpOnSight } = context;
  const slots = new Map<Element, BadgeSlot>();
  const slotByHost = new WeakMap<Element, BadgeSlot>();

  const renderBadge = (slot: BadgeSlot): void => {
    const container: HTMLElement | null = slot.container;
    if (
      container === null ||
      !shouldDrawBadge(slot.verdict.tier, runtime().settings.showLikelyHuman)
    ) {
      return;
    }
    render(
      h(Badge, {
        tier: slot.verdict.tier,
        labelStyle: runtime().settings.labelStyle,
        density: slot.post.density ?? adapter.badgeDensity,
        lowConfidence: slot.verdict.lowConfidence,
        paused: !runtime().config.tiers.t2,
        loading: isLookingUp(slot),
        stillWhileLoading: !card.isOpen(slot),
        glyphOnlyAtCommentDensity: runtime().settings.redditCommentLabels !== "label",
        onOpen: () => {
          if (slot.mounted !== null) card.controller.requestOpen(slot.mounted.shadowHost);
        },
        onClose: () => card.controller.requestClose(),
      }),
      container,
    );
  };

  const unmountBadge = (slot: BadgeSlot): void => {
    if (slot.mounted === null) return;
    if (card.isOpen(slot)) card.controller.closeNow();
    slot.mounted.remove();
    slot.mounted = null;
    slot.container = null;
  };

  const syncBadge = (slot: BadgeSlot): void => {
    if (!shouldDrawBadge(slot.verdict.tier, runtime().settings.showLikelyHuman)) {
      unmountBadge(slot);
      return;
    }
    if (slot.mounted !== null || slot.mounting !== null) {
      renderBadge(slot);
      return;
    }
    slot.mounting = mountBadge(
      ctx,
      slot.post.anchor,
      (container) => {
        slot.container = container;
        renderBadge(slot);
        return () => render(null, container);
      },
      theme(),
      shadowCss,
    )
      .then((mounted) => {
        if (!slots.has(slot.post.element)) {
          mounted.remove();
          return;
        }
        slot.mounted = mounted;
        // A host adopted from an earlier script instance never ran the render callback.
        slot.container ??= mounted.shadowHost.shadowRoot?.querySelector("body") ?? null;
        slotByHost.set(mounted.shadowHost, slot);
        slot.post.element.setAttribute(BADGED_ATTRIBUTE, "1");
        recordBadged(kindOfPost(slot.post), slot.post.element);
        syncBadge(slot);
      })
      .finally(() => {
        slot.mounting = null;
      });
  };

  const attachPost = (post: PostRef): void => {
    if (slots.has(post.element)) return;
    const handle: BadgeHandle = resolver.attach(post);
    const slot: BadgeSlot = {
      post,
      handle,
      verdict: handle.current(),
      mounted: null,
      container: null,
      mounting: null,
      unsubscribe: () => undefined,
    };
    slots.set(post.element, slot);
    slot.unsubscribe = handle.subscribe((verdict) => {
      slot.verdict = verdict;
      syncBadge(slot);
      if (card.isOpen(slot)) card.renderCard();
    });
    syncBadge(slot);
    // Observers attach a post only near the viewport (ADR-0019), so this is a lookup on sight. It
    // comes after the subscription: a cache hit rescores synchronously, and a badge subscribed
    // later would keep drawing the Tier 0 verdict it read first.
    if (looksUpOnSight) void handle.lookupOnSight();
  };

  const detachElement = (element: Element): void => {
    const slot: BadgeSlot | undefined = slots.get(element);
    if (slot === undefined) return;
    slots.delete(element);
    slot.unsubscribe();
    unmountBadge(slot);
    resolver.detach(slot.post);
    element.removeAttribute(BADGED_ATTRIBUTE);
  };

  return {
    attachPost,
    detachElement,
    detachAll: () => {
      for (const element of [...slots.keys()]) detachElement(element);
    },
    syncBadge,
    renderBadge,
    slotAtHost: (host) => slotByHost.get(host),
    all: () => slots.values(),
  };
}
