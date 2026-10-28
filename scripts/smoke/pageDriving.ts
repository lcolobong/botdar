/**
 * Page-driving helpers shared by the feed, extension-page and store captures: opening a themed
 * page, waiting for badges to mount, finding the badge to hover and waiting for its card to open.
 */
import type { BrowserContext, Locator, Page } from "playwright";
import type { SmokeTheme, Viewport } from "./sceneTypes.ts";

export interface HoverTarget {
  readonly control: Locator;
  readonly name: string;
}

/** Match BADGE_ELEMENT_NAME and CARD_ELEMENT_NAME in src/ui/mount.ts; the scripts avoid WXT client code. */
const badgeSelector = "botdar-badge";
const cardSelector = "botdar-card";
/**
 * The badge host lays out as a block, so hovering it lands on empty row space; the control inside
 * its open shadow root is what opens the card. Playwright selectors pierce open shadow roots.
 */
const badgeControlSelector = `${badgeSelector} button`;
/** Accessible names from src/ui/labels.ts, most interesting first. */
const preferredBadgeNames: readonly string[] = ["Likely bot", "Unsure"];
const badgeWaitMs = 3_000;
/** Tier 1 bodies land after the first badge mounts, so a Likely bot badge may follow a little later. */
const preferredBadgeWaitMs = 2_000;
const cardOpenWaitMs = 1_000;

export async function openThemedPage(
  context: BrowserContext,
  theme: SmokeTheme,
  viewport: Viewport,
  markHostTheme: boolean,
): Promise<Page> {
  const page: Page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  if (markHostTheme) {
    // The content script reads html[data-theme] when it mounts, so the attribute must exist before
    // the page's own scripts run. Init scripts fire before <html> is parsed, hence the observer.
    await page.addInitScript((hostTheme: string) => {
      const markRoot = (): boolean => {
        const root: HTMLElement | null = document.documentElement;
        if (root === null) return false;
        root.setAttribute("data-theme", hostTheme);
        // YouTube marks its dark theme with a bare `dark` attribute instead.
        if (hostTheme === "dark") root.setAttribute("dark", "");
        return true;
      };
      if (markRoot()) return;
      const rootObserver = new MutationObserver(() => {
        if (markRoot()) rootObserver.disconnect();
      });
      rootObserver.observe(document, { childList: true });
    }, theme);
  }
  return page;
}

function badgeControlNamed(page: Page, name: string): Locator {
  return page.locator(badgeSelector).getByRole("button", { name, exact: true }).first();
}

/** Waits for any badge, then briefly for the most interesting one, so Tier 1 verdicts make the capture. */
export async function waitForBadges(page: Page): Promise<boolean> {
  const badgeMounted: boolean = await page
    .locator(badgeControlSelector)
    .first()
    .waitFor({ state: "attached", timeout: badgeWaitMs })
    .then(() => true)
    .catch(() => false);
  if (badgeMounted) {
    const [firstChoice = ""] = preferredBadgeNames;
    await badgeControlNamed(page, firstChoice)
      .waitFor({ state: "attached", timeout: preferredBadgeWaitMs })
      .catch(() => undefined);
  }
  return badgeMounted;
}

/**
 * The badge after `hoverAnchor` when the scene names one; otherwise the first badge control named
 * Likely bot, else Unsure, else whichever badge comes first.
 */
export async function findHoverTarget(
  page: Page,
  hoverAnchor?: string,
): Promise<HoverTarget | undefined> {
  if (hoverAnchor !== undefined) {
    // The badge host mounts as the anchor's next sibling (src/ui/mount.ts, append: "after").
    const control: Locator = page.locator(`${hoverAnchor} + ${badgeControlSelector}`).first();
    if ((await control.count()) === 0) {
      return undefined;
    }
    return { control, name: (await control.getAttribute("aria-label")) ?? "unnamed badge" };
  }
  for (const name of preferredBadgeNames) {
    const control: Locator = badgeControlNamed(page, name);
    if ((await control.count()) > 0) {
      return { control, name };
    }
  }
  const control: Locator = page.locator(badgeControlSelector).first();
  if ((await control.count()) === 0) {
    return undefined;
  }
  return { control, name: (await control.getAttribute("aria-label")) ?? "unnamed badge" };
}

export interface CardBox {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The card host's box once it is displayed with rendered content, or undefined when it never
 * opened. The wiring toggles the host's `display` between none and block and renders the card
 * into its shadow root on open, so an open card has a height.
 */
export function waitForCardOpen(page: Page): Promise<CardBox | undefined> {
  return page
    .waitForFunction(
      (selector: string): CardBox | false => {
        const host: Element | null = document.querySelector(selector);
        if (host === null || getComputedStyle(host).display === "none") {
          return false;
        }
        const { top, bottom, height } = host.getBoundingClientRect();
        return height > 0 && { top, bottom };
      },
      cardSelector,
      { timeout: cardOpenWaitMs },
    )
    .then((handle) => handle.jsonValue())
    .then((box) => (box === false ? undefined : box))
    .catch(() => undefined);
}
