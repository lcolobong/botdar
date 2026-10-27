/**
 * Host-theme detection and shadow-root mounting for the badge and the hover card
 * (docs/architecture.md, "Badge and hover card mounting"). The stylesheet text is passed in, built
 * once into a constructed sheet and adopted by every shadow root. The content script that uses
 * these helpers must declare `cssInjectionMode: "manual"` and import its stylesheets with
 * `?inline`, bundled through `shadowStyles`: WXT's `"ui"` mode fetches the CSS at runtime, which
 * lists the file under `web_accessible_resources` and lets any page probe for the extension
 * (ADR-0013). The Preact components arrive through the injected `render` function.
 */

import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import type { PlatformId } from "@/src/core/types";
import type { SharedStyles } from "./sharedStyles";
import { applySharedStyles, sharedStylesFor } from "./sharedStyles";

export type HostTheme = "light" | "dark";

/** Renders into the shadow-root container and returns the function that unmounts it. */
export type RenderFn = (container: HTMLElement) => () => void;

export interface MountedUi {
  shadowHost: HTMLElement;
  setTheme: (theme: HostTheme) => void;
  /** Positions a fixed host (the card) in viewport pixels. */
  setPlacement: (placement: { top: number; left: number }) => void;
  /** Shows or hides the host. */
  setVisible: (visible: boolean) => void;
  remove: () => void;
}

/**
 * Host geometry travels through custom properties: WXT's `:host { all: initial !important }` reset
 * wipes ordinary inline `top`/`left`/`display` on the host, but `all` leaves custom properties
 * alone, so the `:host` rules below read them with `var()`.
 */
const PLACEMENT_PROPERTIES = {
  top: "--botdar-top",
  left: "--botdar-left",
  display: "--botdar-display",
} as const;

function placementControls(host: HTMLElement): Pick<MountedUi, "setPlacement" | "setVisible"> {
  return {
    setPlacement: ({ top, left }) => {
      host.style.setProperty(PLACEMENT_PROPERTIES.top, `${top}px`);
      host.style.setProperty(PLACEMENT_PROPERTIES.left, `${left}px`);
    },
    setVisible: (visible) => {
      host.style.setProperty(PLACEMENT_PROPERTIES.display, visible ? "block" : "none");
    },
  };
}

export const BADGE_ELEMENT_NAME = "botdar-badge";
export const CARD_ELEMENT_NAME = "botdar-card";

/**
 * Layout of the host elements themselves. These rules go into the shadow stylesheet right after
 * WXT's `:host { all: initial !important }` reset, so they need `!important` too to win by source
 * order. Setting `host.style` instead would not work: for important declarations the shadow tree's
 * own rules beat the document's. Without this the badge host is `inline` with a block child and
 * wraps onto its own full-width line under the handle.
 */
const HOST_STYLE_BY_ELEMENT: Readonly<Record<string, string>> = {
  [BADGE_ELEMENT_NAME]:
    ":host { display: inline-flex !important; vertical-align: middle !important; margin-left: 4px !important; }",
  [CARD_ELEMENT_NAME]:
    ":host { position: fixed !important; top: var(--botdar-top, 0px) !important; left: var(--botdar-left, 0px) !important; display: var(--botdar-display, none) !important; z-index: 2147483000 !important; }",
};

const DARK_LUMINANCE_CEILING = 128;

const mountedByHost = new WeakMap<Element, MountedUi>();
const pendingBadgeByAnchor = new WeakMap<Element, Promise<MountedUi>>();
let pendingCard: Promise<MountedUi> | null = null;

/** Perceived luminance of an `rgb()`/`rgba()` colour on a 0..255 scale; undefined when transparent or unparseable. */
function luminanceOf(color: string): number | undefined {
  const match: RegExpMatchArray | null = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/,
  );
  if (match === null) {
    return undefined;
  }
  const [, red = "0", green = "0", blue = "0", alpha = "1"] = match;
  if (Number(alpha) === 0) {
    return undefined;
  }
  return 0.299 * Number(red) + 0.587 * Number(green) + 0.114 * Number(blue);
}

function themeFromColorScheme(colorScheme: string | undefined): HostTheme | undefined {
  if (colorScheme === undefined || colorScheme === "") {
    return undefined;
  }
  return colorScheme.includes("dark") ? "dark" : "light";
}

function detectXTheme(doc: Document): HostTheme {
  const view: Window | null = doc.defaultView;
  const background: string = view?.getComputedStyle(doc.documentElement).backgroundColor ?? "";
  const luminance: number | undefined = luminanceOf(background);
  if (luminance !== undefined) {
    return luminance < DARK_LUMINANCE_CEILING ? "dark" : "light";
  }
  const bodyScheme: string | undefined = doc.body
    ? view?.getComputedStyle(doc.body).colorScheme
    : undefined;
  return themeFromColorScheme(bodyScheme) ?? "light";
}

function detectRedditTheme(doc: Document): HostTheme {
  const declared: string | undefined = doc.documentElement.dataset.theme;
  if (declared !== undefined) {
    return declared.includes("dark") ? "dark" : "light";
  }
  const hasDarkClass: boolean =
    doc.documentElement.classList.contains("theme-dark") ||
    (doc.body?.classList.contains("theme-dark") ?? false);
  return hasDarkClass ? "dark" : "light";
}

function detectBlueskyTheme(doc: Document): HostTheme {
  const declared: string | undefined = doc.documentElement.dataset.theme;
  if (declared !== undefined) {
    // Bluesky's "dim" theme is dark for badge contrast purposes.
    return declared === "light" ? "light" : "dark";
  }
  const prefersDark: boolean =
    doc.defaultView?.matchMedia("(prefers-color-scheme: dark)").matches ?? false;
  return prefersDark ? "dark" : "light";
}

/** Joins `?inline` stylesheet imports into the one text block a shadow root receives. */
export function shadowStyles(...sheets: string[]): string {
  return sheets.join("\n");
}

const YOUTUBE_DARK_ATTRIBUTE = "dark";

export function detectHostTheme(platform: PlatformId, doc: Document = document): HostTheme {
  switch (platform) {
    case "x":
      return detectXTheme(doc);
    case "reddit":
      return detectRedditTheme(doc);
    case "bluesky":
      return detectBlueskyTheme(doc);
    case "hackernews":
      // Hacker News has one theme, a light one, whatever the system prefers.
      return "light";
    case "youtube":
      // GUESS: YouTube marks its dark theme with a `dark` attribute on <html>; the recording
      // (tests/fixtures/youtube/html/watch.html) is light and carries none.
      return doc.documentElement.hasAttribute(YOUTUBE_DARK_ATTRIBUTE) ? "dark" : "light";
  }
}

/**
 * createShadowRootUi registers `ctx.onInvalidated(remove)` for every UI and drops the unsubscribe,
 * so each removed badge's closure (its host, and through the anchor the detached post) stayed
 * reachable from the context until the page unloaded. Handing WXT this view of the context keeps
 * the unsubscribe so `remove` can release it.
 */
function contextReleasedOnRemove(ctx: ContentScriptContext): {
  context: ContentScriptContext;
  release: () => void;
} {
  const unsubscribes: Array<() => void> = [];
  const context = Object.create(ctx, {
    onInvalidated: {
      value: (callback: () => void): (() => void) => {
        const unsubscribe: () => void = ctx.onInvalidated(callback);
        unsubscribes.push(unsubscribe);
        return unsubscribe;
      },
    },
  }) as ContentScriptContext;
  return { context, release: () => unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe()) };
}

async function createMountedUi(
  ctx: ContentScriptContext,
  name: string,
  anchor: Element | undefined,
  render: RenderFn,
  theme: HostTheme,
  css: string,
): Promise<MountedUi> {
  const styles: SharedStyles = sharedStylesFor(css);
  const { context, release } = contextReleasedOnRemove(ctx);
  // Only the host rules and any document-level at-rules pass through WXT's `<style>`; the bundled
  // sheets are adopted after it, so the host rules still follow WXT's reset (see above).
  const ui = await createShadowRootUi(context, {
    name,
    css: shadowStyles(HOST_STYLE_BY_ELEMENT[name] ?? "", styles.documentCss),
    position: "inline",
    anchor: anchor ?? document.body,
    append: anchor === undefined ? "last" : "after",
    onMount: (container) => render(container),
    onRemove: (unmount) => unmount?.(),
  });
  applySharedStyles(ui.shadow, styles);
  const mounted: MountedUi = {
    shadowHost: ui.shadowHost,
    ...placementControls(ui.shadowHost),
    setTheme: (nextTheme) => {
      ui.shadowHost.dataset.theme = nextTheme;
    },
    remove: () => {
      ui.remove();
      release();
      mountedByHost.delete(ui.shadowHost);
    },
  };
  mounted.setTheme(theme);
  mountedByHost.set(ui.shadowHost, mounted);
  ui.mount();
  return mounted;
}

/** Wraps a badge host that outlived its registry entry (an earlier script instance mounted it). */
function adoptExistingHost(host: Element): MountedUi {
  const adopted: MountedUi = {
    shadowHost: host as HTMLElement,
    ...placementControls(host as HTMLElement),
    setTheme: (theme) => {
      (host as HTMLElement).dataset.theme = theme;
    },
    remove: () => {
      host.remove();
      mountedByHost.delete(host);
    },
  };
  mountedByHost.set(host, adopted);
  return adopted;
}

/** Mounts a badge inline after the anchor. Idempotent: an existing badge sibling is reused. */
export function mountBadge(
  ctx: ContentScriptContext,
  anchor: Element,
  render: RenderFn,
  theme: HostTheme,
  css: string,
): Promise<MountedUi> {
  const sibling: Element | null = anchor.nextElementSibling;
  if (sibling !== null && sibling.tagName.toLowerCase() === BADGE_ELEMENT_NAME) {
    const existing: MountedUi = mountedByHost.get(sibling) ?? adoptExistingHost(sibling);
    existing.setTheme(theme);
    return Promise.resolve(existing);
  }
  // The sibling check cannot see a mount that is still being created, so in-flight mounts are
  // tracked per anchor until they land in the DOM.
  const pending: Promise<MountedUi> | undefined = pendingBadgeByAnchor.get(anchor);
  if (pending !== undefined) {
    return pending;
  }
  const mounting: Promise<MountedUi> = createMountedUi(
    ctx,
    BADGE_ELEMENT_NAME,
    anchor,
    render,
    theme,
    css,
  ).finally(() => pendingBadgeByAnchor.delete(anchor));
  pendingBadgeByAnchor.set(anchor, mounting);
  return mounting;
}

/** Mounts the single hover card on the body; repeated calls return the same card. */
export function mountCard(
  ctx: ContentScriptContext,
  render: RenderFn,
  theme: HostTheme,
  css: string,
): Promise<MountedUi> {
  if (pendingCard !== null) {
    return pendingCard.then((card) => {
      card.setTheme(theme);
      return card;
    });
  }
  pendingCard = createMountedUi(ctx, CARD_ELEMENT_NAME, undefined, render, theme, css).then(
    (card): MountedUi => ({
      ...card,
      remove: () => {
        card.remove();
        pendingCard = null;
      },
    }),
  );
  pendingCard.catch(() => {
    pendingCard = null;
  });
  return pendingCard;
}
