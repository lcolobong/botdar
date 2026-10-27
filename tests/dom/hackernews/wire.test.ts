// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://news.ycombinator.com/item?id=1"}

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/src/core/settings";
import { defaultWeights } from "@/src/core/scoring/weights";
import {
  createHackerNewsAdapter,
  hackerNewsOnSight,
  matchesHackerNews,
} from "@/src/platforms/hackernews/adapter";
import { IDLE_TIMEOUT_MS } from "@/src/platforms/hackernews/observer";
import { createFirebaseUserSource } from "@/src/platforms/hackernews/sources/firebaseUser";
import type { OnSightRuntime } from "@/src/platforms/onSightWire";
import { wireOnSight } from "@/src/platforms/onSightWire";
import { BADGE_ELEMENT_NAME } from "@/src/ui/mount";
import { loadHackerNewsFixture } from "./fixtures";

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const RECORDED_USER: Record<string, unknown> = JSON.parse(
  readFileSync(resolvePath(process.cwd(), "tests/fixtures/hackernews/firebase/user.json"), "utf8"),
);
/** The recorded thread's OP, whose lookup answers null (an id with no account). */
const UNKNOWN_AUTHOR = "tomas_bakes28";

/** Every other author answers with the recorded established account's body under their own id. */
const fetchUser = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const handle: string = decodeURIComponent(/\/user\/(.+)\.json$/.exec(String(input))?.[1] ?? "");
  const body: unknown = handle === UNKNOWN_AUTHOR ? null : { ...RECORDED_USER, id: handle };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
});

let disposeCurrent: (() => void) | undefined;

async function wireThread(): Promise<void> {
  loadHackerNewsFixture("thread");
  await fakeBrowser.storage.local.set({ [SETTINGS_STORAGE_KEY]: defaultSettings });
  const ctx = {
    options: {},
    onInvalidated: () => () => undefined,
    addEventListener: (target: EventTarget, type: string, handler: EventListener) =>
      target.addEventListener(type, handler),
  } as unknown as ContentScriptContext;
  const loadRuntime = async (): Promise<OnSightRuntime> => ({
    config: {
      platform: "hackernews",
      enabled: true,
      tiers: { t1: false, t2: true },
      rateLimitPerMinute: 30,
      policyVersion: 1,
    },
    weights: defaultWeights.hackernews,
    settings: defaultSettings,
  });
  disposeCurrent = await wireOnSight(ctx, "", hackerNewsOnSight, {
    adapter: createHackerNewsAdapter({
      sources: [createFirebaseUserSource({ fetch: fetchUser as unknown as typeof fetch })],
    }),
    loadRuntime,
    openSettings: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS);
}

const badgeHosts = (): Element[] => [...document.querySelectorAll(BADGE_ELEMENT_NAME)];
const labelOf = (host: Element | undefined): string | null | undefined =>
  host?.shadowRoot?.querySelector("button")?.getAttribute("aria-label");

describe("wireOnSight on a recorded Hacker News thread", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    fetchUser.mockClear();
    vi.useFakeTimers({ now: NOW });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    disposeCurrent?.();
    disposeCurrent = undefined;
    vi.useRealTimers();
  });

  it("matches only news.ycombinator.com over https", () => {
    expect(matchesHackerNews(new URL("https://news.ycombinator.com/item?id=1"))).toBe(true);
    expect(matchesHackerNews(new URL("http://news.ycombinator.com/"))).toBe(false);
    expect(matchesHackerNews(new URL("https://hacker-news.firebaseio.com/v0/"))).toBe(false);
  });

  it("badges every author right after their name and looks the first screen up on sight", async () => {
    await wireThread();
    await vi.waitFor(() => expect(badgeHosts()).toHaveLength(83));
    for (const host of badgeHosts()) {
      expect(host.previousElementSibling?.matches("a.hnuser")).toBe(true);
    }
    // A burst of ten serves the first screen; the rest wait for the limiter.
    expect(fetchUser).toHaveBeenCalledTimes(10);
    expect(String(fetchUser.mock.calls[0]?.[0])).toBe(
      `https://hacker-news.firebaseio.com/v0/user/${UNKNOWN_AUTHOR}.json`,
    );
  });

  it("reads a looked-up account with the real weights, and an unknown id as No read", async () => {
    await wireThread();
    const [storyAuthor, firstCommenter] = [
      document.querySelector(".subtext a.hnuser"),
      document.querySelector("tr.comtr .comhead a.hnuser"),
    ];
    await vi.waitFor(() =>
      expect(labelOf(firstCommenter?.nextElementSibling ?? undefined)).toBe("Likely human"),
    );
    expect(storyAuthor?.textContent).toBe(UNKNOWN_AUTHOR);
    // The two lookups run side by side and their response bodies are read asynchronously, so under
    // a loaded test run the OP's can settle after the commenter's.
    await vi.waitFor(() =>
      expect(labelOf(storyAuthor?.nextElementSibling ?? undefined)).toBe("No read"),
    );
  });
});
