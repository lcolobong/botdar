/**
 * Host-theme detection and shadow-root mounting for the badge and the hover card
 * (docs/architecture.md, "Badge and hover card mounting"). The content script that uses these
 * helpers must declare `cssInjectionMode: "ui"` so WXT injects the entrypoint's CSS into the shadow
 * root; the Preact components arrive through the injected `render` function.
 */

import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import type { PlatformId } from "@/src/core/types";

export type HostTheme = "light" | "dark";

/** Renders into the shadow-root container and returns the function that unmounts it. */
export type RenderFn = (container: HTMLElement) => () => void;

export interface MountedUi {
  shadowHost: HTMLElement;
  setTheme: (theme: HostTheme) => void;
  remove: () => void;
}

export const BADGE_ELEMENT_NAME = "botdar-badge";
export const CARD_ELEMENT_NAME = "botdar-card";

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

export function detectHostTheme(platform: PlatformId, doc: Document = document): HostTheme {
  switch (platform) {
    case "x":
      return detectXTheme(doc);
    case "reddit":
      return detectRedditTheme(doc);
    case "bluesky":
      return detectBlueskyTheme(doc);
  }
}

async function createMountedUi(
  ctx: ContentScriptContext,
  name: string,
  anchor: Element | undefined,
  render: RenderFn,
  theme: HostTheme,
): Promise<MountedUi> {
  const ui = await createShadowRootUi(ctx, {
    name,
    position: "inline",
    anchor: anchor ?? document.body,
    append: anchor === undefined ? "last" : "after",
    onMount: (container) => render(container),
    onRemove: (unmount) => unmount?.(),
  });
  const mounted: MountedUi = {
    shadowHost: ui.shadowHost,
    setTheme: (nextTheme) => {
      ui.shadowHost.dataset.theme = nextTheme;
    },
    remove: () => {
      ui.remove();
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
): Promise<MountedUi> {
  const sibling: Element | null = anchor.nextElementSibling;
  if (sibling !== null && sibling.tagName.toLowerCase() === BADGE_ELEMENT_NAME) {
    const existing: MountedUi = mountedByHost.get(sibling) ?? adoptExistingHost(sibling);
    existing.setTheme(theme);
    return Promise.resolve(existing);
  }
  // The sibling check cannot see a mount that is still awaiting its CSS, so in-flight mounts are
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
  ).finally(() => pendingBadgeByAnchor.delete(anchor));
  pendingBadgeByAnchor.set(anchor, mounting);
  return mounting;
}

/** Mounts the single hover card on the body; repeated calls return the same card. */
export function mountCard(
  ctx: ContentScriptContext,
  render: RenderFn,
  theme: HostTheme,
): Promise<MountedUi> {
  if (pendingCard !== null) {
    return pendingCard.then((card) => {
      card.setTheme(theme);
      return card;
    });
  }
  pendingCard = createMountedUi(ctx, CARD_ELEMENT_NAME, undefined, render, theme).then(
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
