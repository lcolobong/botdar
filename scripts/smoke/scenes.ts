/**
 * Scene definitions and capture helpers for the smoke runner. Every capture returns a SceneRecord
 * for the manifest instead of throwing, so one missing page or badge never stops the run.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";
import type { FixtureSource, SmokeFeedScene, SmokePlatformId } from "./fixtureServer.ts";
import { fixtureUrl, resolveFixture } from "./fixtureServer.ts";

export type SmokeTheme = "light" | "dark";
export type SceneGroup = SmokePlatformId | "pages" | "store";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface ExtensionPageScene {
  readonly scene: "popup" | "popup-diagnostics" | "options" | "onboarding";
  readonly file: string;
  readonly viewport: Viewport;
  /** Written to the extension's storage.local before the page is captured. */
  readonly seedStorage?: Record<string, unknown>;
  readonly note?: string;
}

export interface SceneRecord {
  readonly group: SceneGroup;
  readonly scene: string;
  readonly theme: SmokeTheme;
  readonly file: string;
  readonly status: "captured" | "skipped";
  readonly reason?: string;
  readonly fixture?: FixtureSource["kind"];
  /** The served page, relative to the repository root. */
  readonly fixtureFile?: string;
  /** The accessible name of the badge the hover scene hovered. */
  readonly hovered?: string;
  /** What the scene definition says to expect, e.g. a feed that draws nothing. */
  readonly note?: string;
}

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
const hoverSettleMs = 150;
const pageSettleMs = 300;
/** Each platform's primary scene keeps the short "hover" name; other scenes get "<scene>-hover". */
const primaryFeedScene = "feed";

export const feedViewport: Viewport = { width: 600, height: 820 };

/** Only referenced inside page.evaluate callbacks, which run in the extension page, not in Node. */
declare const chrome: {
  storage: {
    local: {
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  };
};

export const extensionPageScenes: readonly ExtensionPageScene[] = [
  { scene: "popup", file: "popup.html", viewport: { width: 340, height: 470 } },
  {
    scene: "popup-diagnostics",
    file: "popup.html",
    viewport: { width: 340, height: 640 },
    seedStorage: { "settings.v1": { developerMode: true } },
    note: "the popup opens as a tab here, so the diagnostics section shows its no-page state",
  },
  { scene: "options", file: "options.html", viewport: { width: 720, height: 1010 } },
  { scene: "onboarding", file: "onboarding.html", viewport: { width: 640, height: 540 } },
];

export function screenshotName(group: SceneGroup, scene: string, theme: SmokeTheme): string {
  return `after-${group}-${scene}-${theme}.png`;
}

export function hoverSceneName(scene: string): string {
  return scene === primaryFeedScene ? "hover" : `${scene}-hover`;
}

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

export async function captureExtensionPage(
  context: BrowserContext,
  extensionId: string,
  buildDir: string,
  pageScene: ExtensionPageScene,
  theme: SmokeTheme,
  outDir: string,
): Promise<SceneRecord> {
  const file: string = screenshotName("pages", pageScene.scene, theme);
  if (!existsSync(join(buildDir, pageScene.file))) {
    return {
      group: "pages",
      scene: pageScene.scene,
      theme,
      file,
      status: "skipped",
      reason: `${pageScene.file} is not in this build`,
    };
  }
  const page: Page = await openThemedPage(context, theme, pageScene.viewport, false);
  try {
    const url = `chrome-extension://${extensionId}/${pageScene.file}`;
    await page.goto(url, { waitUntil: "load" });
    if (pageScene.seedStorage !== undefined) {
      await page.evaluate((seed) => chrome.storage.local.set(seed), pageScene.seedStorage);
      await page.goto(url, { waitUntil: "load" });
    }
    await page.waitForTimeout(pageSettleMs);
    await page.screenshot({ path: join(outDir, file) });
    if (pageScene.seedStorage !== undefined) {
      // The profile is shared by every scene, so a seed must not leak into the next capture.
      await page.evaluate(
        (keys) => chrome.storage.local.remove(keys),
        Object.keys(pageScene.seedStorage),
      );
    }
    const record: SceneRecord = {
      group: "pages",
      scene: pageScene.scene,
      theme,
      file,
      status: "captured",
    };
    return pageScene.note === undefined ? record : { ...record, reason: pageScene.note };
  } finally {
    await page.close();
  }
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

export async function captureFeed(
  context: BrowserContext,
  feedScene: SmokeFeedScene,
  theme: SmokeTheme,
  outDir: string,
): Promise<SceneRecord[]> {
  const fixture: FixtureSource = resolveFixture(feedScene.platform, feedScene.fixtureFile);
  const hoverScene: string = hoverSceneName(feedScene.scene);
  const feedFile: string = screenshotName(feedScene.platform, feedScene.scene, theme);
  const hoverFile: string = screenshotName(feedScene.platform, hoverScene, theme);
  const base = {
    group: feedScene.platform,
    theme,
    fixture: fixture.kind,
    fixtureFile: fixture.file,
    ...(feedScene.note === undefined ? {} : { note: feedScene.note }),
  } as const;
  if (!existsSync(fixture.path)) {
    const reason = `fixture ${fixture.path} is missing`;
    return [
      { ...base, scene: feedScene.scene, file: feedFile, status: "skipped", reason },
      { ...base, scene: hoverScene, file: hoverFile, status: "skipped", reason },
    ];
  }
  const page: Page = await openThemedPage(context, theme, feedViewport, true);
  try {
    await page.goto(fixtureUrl(feedScene), { waitUntil: "domcontentloaded" });
    const badgeMounted: boolean = await waitForBadges(page);
    await page.screenshot({ path: join(outDir, feedFile) });
    const feedRecord: SceneRecord = {
      ...base,
      scene: feedScene.scene,
      file: feedFile,
      status: "captured",
      ...(badgeMounted ? {} : { reason: "no badge mounted within the wait; captured bare feed" }),
    };
    const target: HoverTarget | undefined = badgeMounted
      ? await findHoverTarget(page, feedScene.hoverAnchor)
      : undefined;
    if (target === undefined) {
      return [
        feedRecord,
        {
          ...base,
          scene: hoverScene,
          file: hoverFile,
          status: "skipped",
          reason: "no badge to hover",
        },
      ];
    }
    await target.control.hover();
    const cardBox: CardBox | undefined = await waitForCardOpen(page);
    await page.waitForTimeout(hoverSettleMs);
    // A card host whose fixed positioning the page's reset stylesheet overrode flows at the end of
    // the body and runs past the fold; the full page keeps it in frame rather than cutting it off.
    const cardCutOff: boolean =
      cardBox !== undefined && (cardBox.top < 0 || cardBox.bottom > feedViewport.height);
    await page.screenshot({ path: join(outDir, hoverFile), fullPage: cardCutOff });
    const reason: string | undefined =
      cardBox === undefined
        ? "card did not open within the wait; captured anyway"
        : cardCutOff
          ? "card opened outside the viewport (host is not positioned); captured the full page"
          : undefined;
    return [
      feedRecord,
      {
        ...base,
        scene: hoverScene,
        file: hoverFile,
        status: "captured",
        hovered: target.name,
        ...(reason === undefined ? {} : { reason }),
      },
    ];
  } finally {
    await page.close();
  }
}
