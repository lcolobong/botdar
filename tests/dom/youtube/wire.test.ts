// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.youtube.com/watch?v=fs4k4h1v9go"}

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { IDLE_TIMEOUT_MS } from "@/src/core/idleSlices";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/src/core/settings";
import { defaultWeights } from "@/src/core/scoring/weights";
import type { OnSightRuntime } from "@/src/platforms/onSightWire";
import { wireOnSight } from "@/src/platforms/onSightWire";
import {
  createYouTubeAdapter,
  matchesYouTube,
  youTubeOnHover,
} from "@/src/platforms/youtube/adapter";
import { createChannelAboutSource } from "@/src/platforms/youtube/sources/channelAbout";
import { BADGE_ELEMENT_NAME } from "@/src/ui/mount";
import { loadWatchFixture } from "./fixtures";

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const recorded = (name: string): string =>
  readFileSync(resolvePath(process.cwd(), "tests/fixtures/youtube/innertube", name), "utf8");

/** Every channel answers with the recorded commenter's About panel: 13 years, four videos. */
const fetchInnertube = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const body: string = String(input).includes("resolve_url")
    ? recorded("resolve-url.json")
    : recorded("browse-about.json");
  return new Response(body, { headers: { "content-type": "application/json" } });
});

let disposeCurrent: (() => void) | undefined;

async function wireWatchPage(): Promise<void> {
  loadWatchFixture();
  await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: defaultSettings });
  const ctx = {
    options: {},
    onInvalidated: () => () => undefined,
    addEventListener: (target: EventTarget, type: string, handler: EventListener) =>
      target.addEventListener(type, handler),
  } as unknown as ContentScriptContext;
  const loadRuntime = async (): Promise<OnSightRuntime> => ({
    config: {
      platform: "youtube",
      enabled: true,
      tiers: { t1: false, t2: true },
      rateLimitPerMinute: 10,
      policyVersion: 1,
    },
    weights: defaultWeights.youtube,
    settings: defaultSettings,
  });
  disposeCurrent = await wireOnSight(ctx, "", youTubeOnHover, {
    adapter: createYouTubeAdapter({
      sources: [
        createChannelAboutSource({
          fetch: fetchInnertube as unknown as typeof fetch,
          clientVersion: () => "2.20261027.01.00",
        }),
      ],
    }),
    loadRuntime,
    openSettings: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
}

const badgeHosts = (): Element[] => [...document.querySelectorAll(BADGE_ELEMENT_NAME)];
const buttonOf = (host: Element | undefined): HTMLButtonElement | null | undefined =>
  host?.shadowRoot?.querySelector("button");

describe("wireOnSight on the recorded YouTube watch page", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    fetchInnertube.mockClear();
    vi.useFakeTimers({ now: NOW });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    disposeCurrent?.();
    disposeCurrent = undefined;
    vi.useRealTimers();
  });

  it("matches only www.youtube.com over https", () => {
    expect(matchesYouTube(new URL("https://www.youtube.com/watch?v=fs4k4h1v9go"))).toBe(true);
    expect(matchesYouTube(new URL("http://www.youtube.com/"))).toBe(false);
    expect(matchesYouTube(new URL("https://m.youtube.com/watch?v=fs4k4h1v9go"))).toBe(false);
  });

  it("badges every commenter right after their handle and looks nobody up before a hover", async () => {
    await wireWatchPage();
    await vi.waitFor(() => expect(badgeHosts()).toHaveLength(60));
    for (const host of badgeHosts()) {
      expect(host.previousElementSibling?.id).toBe("author-text");
      expect(buttonOf(host)?.getAttribute("aria-label")).toBe("No read");
    }
    expect(fetchInnertube).not.toHaveBeenCalled();
  });

  it("looks a hovered commenter up through innertube and reads them as Likely human", async () => {
    await wireWatchPage();
    await vi.waitFor(() => expect(badgeHosts()).toHaveLength(60));
    const [first] = badgeHosts();
    buttonOf(first)?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
    await vi.waitFor(() =>
      expect(buttonOf(badgeHosts()[0])?.getAttribute("aria-label")).toBe("Likely human"),
    );
    expect(fetchInnertube).toHaveBeenCalledTimes(2);
    expect(String(fetchInnertube.mock.calls[0]?.[0])).toBe(
      "https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false",
    );
    // Only the hovered commenter was looked up; the rest still read the page alone.
    expect(buttonOf(badgeHosts()[1])?.getAttribute("aria-label")).toBe("No read");
  });
});
