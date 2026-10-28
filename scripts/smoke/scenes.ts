/**
 * Scene definitions and capture helpers for the smoke runner. Every capture returns a SceneRecord
 * for the manifest instead of throwing, so one missing page or badge never stops the run.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { FixtureSource } from "./fixtureFiles.ts";
import { fixtureUrl, resolveFixture } from "./fixtureFiles.ts";
import type { CardBox, HoverTarget } from "./pageDriving.ts";
import { findHoverTarget, openThemedPage, waitForBadges, waitForCardOpen } from "./pageDriving.ts";
import type { SmokeFeedScene } from "./sceneTable.ts";
import type { SceneRecord, SmokeTheme, Viewport } from "./sceneTypes.ts";
import { feedViewport, screenshotName } from "./sceneTypes.ts";

export interface ExtensionPageScene {
  readonly scene: "popup" | "popup-diagnostics" | "options" | "onboarding";
  readonly file: string;
  readonly viewport: Viewport;
  /** Written to the extension's storage.local before the page is captured. */
  readonly seedStorage?: Record<string, unknown>;
  readonly note?: string;
}

const hoverSettleMs = 150;
const pageSettleMs = 300;
/** Each platform's primary scene keeps the short "hover" name; other scenes get "<scene>-hover". */
const primaryFeedScene = "feed";

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

export function hoverSceneName(scene: string): string {
  return scene === primaryFeedScene ? "hover" : `${scene}-hover`;
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
