/**
 * The Chrome Web Store screenshots: five captures at exactly the store's viewport, device scale 1.
 * Run through `pnpm smoke -- --only store --viewport 1280x800`; the file names are the ones the
 * listing uses (store/screenshots/README.md).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { fixtureUrl, smokeFeedScenes } from "./fixtureServer.ts";
import type { SmokeFeedScene, SmokePlatformId } from "./fixtureServer.ts";
import type { CardBox, HoverTarget, SceneRecord, SmokeTheme, Viewport } from "./scenes.ts";
import { findHoverTarget, openThemedPage, waitForBadges, waitForCardOpen } from "./scenes.ts";

export const storeViewport: Viewport = { width: 1280, height: 800 };

/** The popup is a fixed 340 px wide extension page; it is captured at its own size, then padded. */
const popupViewport: Viewport = { width: 340, height: 470 };
const pageSettleMs = 300;
const hoverSettleMs = 150;

interface StoreFeedScene {
  readonly file: string;
  readonly platform: SmokePlatformId;
  readonly theme: SmokeTheme;
}

const storeFeedScenes: readonly StoreFeedScene[] = [
  { file: "01-x-feed-card.png", platform: "x", theme: "light" },
  { file: "02-bluesky-dark-card.png", platform: "bluesky", theme: "dark" },
  { file: "03-reddit-declared.png", platform: "reddit", theme: "light" },
];

function record(
  file: string,
  theme: SmokeTheme,
  status: SceneRecord["status"],
  reason?: string,
  hovered?: string,
): SceneRecord {
  return {
    group: "store",
    scene: file.replace(/\.png$/, ""),
    theme,
    file,
    status,
    ...(reason === undefined ? {} : { reason }),
    ...(hovered === undefined ? {} : { hovered }),
  };
}

async function captureFeedWithCard(
  context: BrowserContext,
  storeScene: StoreFeedScene,
  viewport: Viewport,
  outDir: string,
): Promise<SceneRecord> {
  const feedScene: SmokeFeedScene | undefined = smokeFeedScenes.find(
    (candidate) => candidate.platform === storeScene.platform && candidate.scene === "feed",
  );
  if (feedScene === undefined) {
    return record(
      storeScene.file,
      storeScene.theme,
      "skipped",
      `no feed scene for ${storeScene.platform}`,
    );
  }
  const page: Page = await openThemedPage(context, storeScene.theme, viewport, true);
  try {
    await page.goto(fixtureUrl(feedScene), { waitUntil: "domcontentloaded" });
    const badgeMounted: boolean = await waitForBadges(page);
    const target: HoverTarget | undefined = badgeMounted ? await findHoverTarget(page) : undefined;
    if (target === undefined) {
      return record(storeScene.file, storeScene.theme, "skipped", "no badge mounted");
    }
    await target.control.hover();
    const cardBox: CardBox | undefined = await waitForCardOpen(page);
    await page.waitForTimeout(hoverSettleMs);
    await page.screenshot({ path: join(outDir, storeScene.file) });
    const reason: string | undefined =
      cardBox === undefined ? "card did not open within the wait; captured anyway" : undefined;
    return record(storeScene.file, storeScene.theme, "captured", reason, target.name);
  } finally {
    await page.close();
  }
}

/** Screenshots an extension page and returns its background color. */
async function captureExtensionPageAt(
  context: BrowserContext,
  url: string,
  viewport: Viewport,
  path: string,
): Promise<string> {
  const page: Page = await openThemedPage(context, "light", viewport, false);
  try {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(pageSettleMs);
    await page.screenshot({ path });
    return await page.evaluate((): string => {
      const bodyColor: string = getComputedStyle(document.body).backgroundColor;
      return bodyColor === "rgba(0, 0, 0, 0)"
        ? getComputedStyle(document.documentElement).backgroundColor
        : bodyColor;
    });
  } finally {
    await page.close();
  }
}

/**
 * Extension pages cannot be framed from a web origin, so the popup is captured alone and then laid
 * centered on a canvas of its own surface color by a data: page that is screenshotted at the store size.
 */
async function padPopup(
  context: BrowserContext,
  popupPath: string,
  surfaceColor: string,
  viewport: Viewport,
  outPath: string,
): Promise<void> {
  const popupBase64: string = (await readFile(popupPath)).toString("base64");
  const canvas: Page = await openThemedPage(context, "light", viewport, false);
  try {
    const markup = `<body style="margin:0;width:${viewport.width}px;height:${viewport.height}px;background:${surfaceColor};display:flex;align-items:center;justify-content:center"><img alt="" src="data:image/png;base64,${popupBase64}" style="width:${popupViewport.width}px"></body>`;
    await canvas.goto(`data:text/html;charset=utf-8,${encodeURIComponent(markup)}`);
    await canvas.waitForFunction(() => document.images[0]?.complete === true);
    await canvas.screenshot({ path: outPath });
  } finally {
    await canvas.close();
  }
}

export async function captureStoreScenes(
  context: BrowserContext,
  extensionId: string,
  buildDir: string,
  viewport: Viewport,
  outDir: string,
): Promise<SceneRecord[]> {
  const records: SceneRecord[] = [];
  for (const storeScene of storeFeedScenes) {
    records.push(await captureFeedWithCard(context, storeScene, viewport, outDir));
  }
  const optionsFile = "04-options.png";
  const popupFile = "05-popup.png";
  if (!existsSync(join(buildDir, "options.html")) || !existsSync(join(buildDir, "popup.html"))) {
    records.push(record(optionsFile, "light", "skipped", "options.html or popup.html is missing"));
    return records;
  }
  await captureExtensionPageAt(
    context,
    `chrome-extension://${extensionId}/options.html`,
    viewport,
    join(outDir, optionsFile),
  );
  records.push(record(optionsFile, "light", "captured"));
  const popupAlonePath: string = join(outDir, "popup-alone.png");
  const surfaceColor: string = await captureExtensionPageAt(
    context,
    `chrome-extension://${extensionId}/popup.html`,
    popupViewport,
    popupAlonePath,
  );
  await padPopup(context, popupAlonePath, surfaceColor, viewport, join(outDir, popupFile));
  records.push(record(popupFile, "light", "captured"));
  return records;
}
