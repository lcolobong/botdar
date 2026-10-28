/** The extension's own pages (popup, options, onboarding) captured by the smoke runner. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { openThemedPage } from "./pageDriving.ts";
import type { SceneRecord, SmokeTheme, Viewport } from "./sceneTypes.ts";
import { screenshotName } from "./sceneTypes.ts";

export interface ExtensionPageScene {
  readonly scene: "popup" | "popup-diagnostics" | "options" | "onboarding";
  readonly file: string;
  readonly viewport: Viewport;
  /** Written to the extension's storage.local before the page is captured. */
  readonly seedStorage?: Record<string, unknown>;
  readonly note?: string;
}

const pageSettleMs = 300;

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
