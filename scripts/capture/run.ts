/**
 * Records a live page from the user's own Chrome as an anonymised fixture, with a screenshot of
 * the page as the extension rendered it.
 *
 *   pnpm capture -- --url <url> --platform x|reddit|bluesky|hackernews|youtube --name <scene>
 *                   [--cdp http://127.0.0.1:9222] [--wait <ms>] [--no-anonymize] [--out <dir>] [--force]
 *
 * Chrome must be running with a DevTools port on a dedicated profile (`pnpm capture:chrome`);
 * Chrome 136+ ignores the port on the default profile. Logged-in sessions and the extension loaded
 * into that profile are what make this work where a fresh automation profile meets the platforms'
 * bot walls. The raw page (real usernames) stays in .output/capture/, which is ignored by git; the
 * anonymised page lands under tests/fixtures/<platform>/html/ for review before it is committed.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import type { AnonymizedSnapshot, SnapshotPlatform } from "../../src/core/snapshot/anonymize.ts";
import {
  SNAPSHOT_PLATFORMS,
  anonymizeSnapshot,
  anonymizeUrl,
  describeAnonymization,
} from "../../src/core/snapshot/anonymize.ts";
import { serializeDocument } from "../../src/core/snapshot/serialize.ts";
import { flagValue } from "../smoke/run.ts";
import { waitForBadges } from "../smoke/pageDriving.ts";

const projectRoot: string = fileURLToPath(new URL("../../", import.meta.url));
const rawOutputDir: string = join(projectRoot, ".output", "capture");
const defaultCdpUrl = "http://127.0.0.1:9222";
const defaultSettleMs = 1_500;
const networkIdleTimeoutMs = 10_000;
const platforms: readonly SnapshotPlatform[] = SNAPSHOT_PLATFORMS;
/** What a reviewer wants counted to judge whether the page and the extension did their part. */
const countedSelectors: Readonly<Record<string, string>> = {
  "shreddit-post": "shreddit-post",
  "shreddit-comment": "shreddit-comment",
  tweets: 'article[data-testid="tweet"]',
  "bluesky posts": '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]',
  "hacker news stories": "tr.athing.submission",
  "hacker news comments": "tr.athing:has(.comment)",
  "youtube comments": "ytd-comment-view-model",
  "botdar-badge hosts": "botdar-badge",
};

interface CaptureOptions {
  url: string;
  platform: SnapshotPlatform;
  name: string;
  cdpUrl: string;
  settleMs: number;
  anonymize: boolean;
  fixtureDir: string;
  /** Overwrite an existing fixture; without it a tracked recording cannot be clobbered by accident. */
  force: boolean;
}

function usage(message: string): never {
  process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    "usage: pnpm capture -- --url <url> --platform x|reddit|bluesky|hackernews|youtube --name <scene>\n" +
      "                      [--cdp http://127.0.0.1:9222] [--wait <ms>] [--no-anonymize] [--out <dir>] [--force]\n",
  );
  process.exit(2);
}

function isPlatform(value: string | undefined): value is SnapshotPlatform {
  return value !== undefined && (platforms as readonly string[]).includes(value);
}

function parseOptions(argv: readonly string[]): CaptureOptions {
  const url: string | undefined = flagValue(argv, "--url");
  const platform: string | undefined = flagValue(argv, "--platform");
  const name: string | undefined = flagValue(argv, "--name");
  if (url === undefined) usage("--url is required");
  if (!isPlatform(platform)) usage("--platform must be x, reddit, bluesky, hackernews or youtube");
  if (name === undefined || !/^[a-z0-9-]+$/.test(name)) usage("--name must be a lowercase slug");
  const wait: string | undefined = flagValue(argv, "--wait");
  return {
    url,
    platform,
    name,
    cdpUrl: flagValue(argv, "--cdp") ?? defaultCdpUrl,
    settleMs: wait === undefined ? defaultSettleMs : Number(wait),
    anonymize: !argv.includes("--no-anonymize"),
    force: argv.includes("--force"),
    fixtureDir:
      flagValue(argv, "--out") ?? join(projectRoot, "tests", "fixtures", platform, "html"),
  };
}

function launchInstructions(cdpUrl: string): string {
  return [
    `No Chrome answered at ${cdpUrl}.`,
    "Start one with its own profile:  pnpm capture:chrome",
    "The first time, sign in to the sites you want to record and load the unpacked build",
    "(.output/chrome-mv3) at chrome://extensions with Developer mode on. Then rerun this command.",
  ].join("\n");
}

async function connect(cdpUrl: string): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(cdpUrl);
  } catch {
    process.stderr.write(`${launchInstructions(cdpUrl)}\n`);
    process.exit(1);
  }
}

function withoutFragment(url: string): string {
  return url.split("#")[0] ?? url;
}

/** Reuses a tab already on the page so a logged-in, scrolled view is captured as the user sees it. */
async function pageFor(context: BrowserContext, url: string): Promise<Page> {
  const target: string = withoutFragment(url);
  const open: Page | undefined = context
    .pages()
    .find((page) => withoutFragment(page.url()) === target);
  if (open !== undefined) {
    await open.bringToFront();
    return open;
  }
  const page: Page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

async function settle(page: Page, settleMs: number): Promise<void> {
  await page
    .waitForLoadState("networkidle", { timeout: networkIdleTimeoutMs })
    .catch(() => undefined);
  await waitForBadges(page);
  await page.waitForTimeout(settleMs);
}

async function countOnPage(page: Page): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [label, selector] of Object.entries(countedSelectors)) {
    counts[label] = await page.locator(selector).count();
  }
  return counts;
}

function fixtureHeader(
  options: CaptureOptions,
  recordedUrl: string,
  recordedAt: string,
  counts: Record<string, number>,
  anonymized: AnonymizedSnapshot | undefined,
): string {
  const source: string = anonymizeUrl(recordedUrl, options.platform);
  const countLine: string = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
  return [
    "<!--",
    `  Recorded from ${source} on ${recordedAt} with pnpm capture, scene "${options.name}",`,
    `  platform ${options.platform}. ${describeAnonymization(anonymized)}`,
    `  On the live page at capture: ${countLine || "nothing counted"}.`,
    "-->",
  ].join("\n");
}

async function main(): Promise<void> {
  const options: CaptureOptions = parseOptions(process.argv.slice(2));
  const browser: Browser = await connect(options.cdpUrl);
  const context: BrowserContext | undefined = browser.contexts()[0];
  if (context === undefined) throw new Error("the connected Chrome has no browser context");
  const fixturePath: string = resolve(options.fixtureDir, `${options.name}.html`);
  const existed: boolean = existsSync(fixturePath);
  if (existed && !options.force) {
    usage(`${fixturePath} exists; pass --force to overwrite it`);
  }
  const page: Page = await pageFor(context, options.url);
  await settle(page, options.settleMs);
  // A matched tab can navigate while the page settles (a feed tab opened into a post); the header
  // and the report carry the page actually recorded.
  const recordedUrl: string = withoutFragment(page.url());
  if (recordedUrl !== withoutFragment(options.url)) {
    process.stderr.write(
      `note: the tab is now at ${recordedUrl}, not ${options.url}; recording that\n`,
    );
  }

  const recordedAt: string = new Date().toISOString().slice(0, 10);
  const counts: Record<string, number> = await countOnPage(page);
  // The serializer is self-contained, so its source can run inside the page.
  const rawHtml: string = await page.evaluate(`(${serializeDocument.toString()})(document)`);
  mkdirSync(rawOutputDir, { recursive: true });
  const stem = `${options.platform}-${options.name}`;
  const rawPath: string = join(rawOutputDir, `${stem}-raw.html`);
  writeFileSync(rawPath, rawHtml);
  const screenshotPath: string = join(rawOutputDir, `${stem}.png`);
  await page.screenshot({ path: screenshotPath });

  const anonymized: AnonymizedSnapshot | undefined = options.anonymize
    ? anonymizeSnapshot(rawHtml, options.platform)
    : undefined;
  const header: string = fixtureHeader(options, recordedUrl, recordedAt, counts, anonymized);
  const body: string = anonymized?.html ?? rawHtml;
  // Prepended, never substituted in: a header that depends on the serializer's exact first line
  // would vanish silently if that line ever changed.
  const fixtureHtml = `<!doctype html>\n${header}\n${body.replace(/^<!doctype html>\n/i, "")}`;
  mkdirSync(options.fixtureDir, { recursive: true });
  writeFileSync(fixturePath, fixtureHtml);

  process.stdout.write(`recorded      ${recordedUrl}\n`);
  process.stdout.write(`raw page      ${rawPath} (${Math.round(rawHtml.length / 1024)} KB)\n`);
  process.stdout.write(`screenshot    ${screenshotPath}\n`);
  process.stdout.write(`fixture       ${fixturePath}${existed ? " (overwritten)" : ""}\n`);
  for (const [label, count] of Object.entries(counts)) {
    if (count > 0) process.stdout.write(`  ${String(count).padStart(5)} ${label}\n`);
  }
  if (anonymized !== undefined) {
    process.stdout.write(
      `anonymised    ${anonymized.handles} identifiers, ${anonymized.replaced} substitutions\n`,
    );
  } else {
    process.stdout.write("NOT anonymised: the fixture holds real usernames; do not commit it.\n");
  }
  await browser.close();
}

const runAsScript: boolean =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runAsScript) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
}
