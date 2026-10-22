/**
 * Scene definitions and capture helpers for the smoke runner. Every capture returns a SceneRecord
 * for the manifest instead of throwing, so one missing page or badge never stops the run.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { FixtureSource, SmokePlatform } from "./fixtureServer.ts";
import { fixtureUrl, resolveFixture } from "./fixtureServer.ts";

export type SmokeTheme = "light" | "dark";
export type SceneGroup = SmokePlatform["id"] | "pages";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface ExtensionPageScene {
  readonly scene: "popup" | "options" | "onboarding";
  readonly file: string;
  readonly viewport: Viewport;
}

export interface SceneRecord {
  readonly group: SceneGroup;
  readonly scene: string;
  readonly theme: SmokeTheme;
  readonly file: string;
  readonly status: "captured" | "skipped";
  readonly reason?: string;
  readonly fixture?: FixtureSource["kind"];
}

/** Matches BADGE_ELEMENT_NAME in src/ui/mount.ts; the scripts avoid importing WXT client code. */
const badgeSelector = "botdar-badge";
const badgeWaitMs = 3_000;
const hoverSettleMs = 400;
const pageSettleMs = 300;

export const feedViewport: Viewport = { width: 600, height: 820 };

export const extensionPageScenes: readonly ExtensionPageScene[] = [
  { scene: "popup", file: "popup.html", viewport: { width: 340, height: 470 } },
  { scene: "options", file: "options.html", viewport: { width: 720, height: 1010 } },
  { scene: "onboarding", file: "onboarding.html", viewport: { width: 640, height: 540 } },
];

export function screenshotName(group: SceneGroup, scene: string, theme: SmokeTheme): string {
  return `after-${group}-${scene}-${theme}.png`;
}

async function openThemedPage(
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
    await page.goto(`chrome-extension://${extensionId}/${pageScene.file}`, { waitUntil: "load" });
    await page.waitForTimeout(pageSettleMs);
    await page.screenshot({ path: join(outDir, file) });
    return { group: "pages", scene: pageScene.scene, theme, file, status: "captured" };
  } finally {
    await page.close();
  }
}

export async function captureFeed(
  context: BrowserContext,
  platform: SmokePlatform,
  theme: SmokeTheme,
  outDir: string,
): Promise<SceneRecord[]> {
  const fixture: FixtureSource = resolveFixture(platform.id);
  const feedFile: string = screenshotName(platform.id, "feed", theme);
  const hoverFile: string = screenshotName(platform.id, "hover", theme);
  const base = { group: platform.id, theme, fixture: fixture.kind } as const;
  if (!existsSync(fixture.path)) {
    const reason = `fixture ${fixture.path} is missing`;
    return [
      { ...base, scene: "feed", file: feedFile, status: "skipped", reason },
      { ...base, scene: "hover", file: hoverFile, status: "skipped", reason },
    ];
  }
  const page: Page = await openThemedPage(context, theme, feedViewport, true);
  try {
    await page.goto(fixtureUrl(platform), { waitUntil: "domcontentloaded" });
    const badgeMounted: boolean = await page
      .locator(badgeSelector)
      .first()
      .waitFor({ state: "attached", timeout: badgeWaitMs })
      .then(() => true)
      .catch(() => false);
    await page.screenshot({ path: join(outDir, feedFile) });
    const feedRecord: SceneRecord = {
      ...base,
      scene: "feed",
      file: feedFile,
      status: "captured",
      ...(badgeMounted ? {} : { reason: "no badge mounted within the wait; captured bare feed" }),
    };
    if (!badgeMounted) {
      return [
        feedRecord,
        {
          ...base,
          scene: "hover",
          file: hoverFile,
          status: "skipped",
          reason: "no badge to hover",
        },
      ];
    }
    await page.locator(badgeSelector).first().hover();
    await page.waitForTimeout(hoverSettleMs);
    await page.screenshot({ path: join(outDir, hoverFile) });
    return [feedRecord, { ...base, scene: "hover", file: hoverFile, status: "captured" }];
  } finally {
    await page.close();
  }
}
