/**
 * The Chrome Web Store screenshots: five captures at exactly the store's viewport, device scale 1.
 * Run through `pnpm smoke -- --only store --viewport 1280x800`; the file names are the ones the
 * listing uses (store/screenshots/README.md).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Locator, Page } from "playwright";
import { BADGE_ELEMENT_NAME } from "../../src/core/botdarMarks.ts";
import { fixtureUrl } from "./fixtureFiles.ts";
import type { SmokeFeedScene, SmokePlatformId } from "./sceneTable.ts";
import { smokeFeedScenes } from "./sceneTable.ts";
import type { CardBox } from "./pageDriving.ts";
import { openThemedPage, waitForCardOpen } from "./pageDriving.ts";
import type { SceneRecord, SmokeTheme, Viewport } from "./sceneTypes.ts";

export const storeViewport: Viewport = { width: 1280, height: 800 };

/** The popup is a fixed 340 px wide extension page; it is captured at its own size, then padded. */
const popupViewport: Viewport = { width: 340, height: 470 };
const pageSettleMs = 300;
const hoverSettleMs = 150;
const badgeWaitMs = 5_000;
/** The slice of the extension API the seeding page script uses; Playwright runs it in the page. */
interface ChromeStorageApi {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
}

/** The storage keys and shapes of src/core/policy/loader.ts; the harness cannot import extension code. */
const policyLastKnownGoodKey = "policy.lkg";
const policyLastAttemptKey = "policy.lastAttempt";
const policyKeyId = "2026-10";
const signedPolicyPath = "policy/dist/v1.json";

interface StoreFeedScene {
  readonly file: string;
  readonly platform: SmokePlatformId;
  readonly theme: SmokeTheme;
  /** The accessible name of the badge whose card the capture opens. */
  readonly badgeName: string;
}

const storeFeedScenes: readonly StoreFeedScene[] = [
  { file: "01-x-feed-card.png", platform: "x", theme: "light", badgeName: "Likely bot" },
  { file: "02-bluesky-dark-card.png", platform: "bluesky", theme: "dark", badgeName: "Likely bot" },
  { file: "03-reddit-declared.png", platform: "reddit", theme: "light", badgeName: "Declared bot" },
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
    await page.goto(fixtureUrl(feedScene, true), { waitUntil: "domcontentloaded" });
    const badgeControl: Locator = page
      .locator(BADGE_ELEMENT_NAME)
      .getByRole("button", { name: storeScene.badgeName, exact: true })
      .first();
    const badgeMounted: boolean = await badgeControl
      .waitFor({ state: "attached", timeout: badgeWaitMs })
      .then(() => true)
      .catch(() => false);
    if (!badgeMounted) {
      return record(
        storeScene.file,
        storeScene.theme,
        "skipped",
        `no "${storeScene.badgeName}" badge mounted`,
      );
    }
    await badgeControl.hover();
    const cardBox: CardBox | undefined = await waitForCardOpen(page);
    await page.waitForTimeout(hoverSettleMs);
    await page.screenshot({ path: join(outDir, storeScene.file) });
    const reason: string | undefined =
      cardBox === undefined ? "card did not open within the wait; captured anyway" : undefined;
    return record(storeScene.file, storeScene.theme, "captured", reason, storeScene.badgeName);
  } finally {
    await page.close();
  }
}

/**
 * Stores a fetched policy the way the service worker does after a successful refresh, so the popup
 * header reads "Policy updated today" and the options Policy section reads "Version 1, signature
 * verified". Written from an extension page because only extension contexts reach chrome.storage.
 */
async function seedFetchedPolicy(
  context: BrowserContext,
  extensionId: string,
  viewport: Viewport,
): Promise<void> {
  const envelope: { payload: string } = JSON.parse(
    await readFile(new URL(`../../${signedPolicyPath}`, import.meta.url), "utf8"),
  );
  const now: number = Date.now();
  const page: Page = await openThemedPage(context, "light", viewport, false);
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: "load" });
    await page.evaluate(
      async (stored: Record<string, unknown>): Promise<void> => {
        const extensionApi = globalThis as unknown as { chrome: ChromeStorageApi };
        await extensionApi.chrome.storage.local.set(stored);
      },
      {
        [policyLastKnownGoodKey]: {
          policy: JSON.parse(envelope.payload),
          fetchedAt: now,
          kid: policyKeyId,
        },
        [policyLastAttemptKey]: { at: now, ok: true },
      },
    );
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
  await seedFetchedPolicy(context, extensionId, viewport);
  // Framed from the top of the page, so the platform switches the caption names come first.
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
