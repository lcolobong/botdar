// @vitest-environment happy-dom
import { render } from "preact";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { POLICY_LAST_ATTEMPT_KEY, POLICY_LKG_KEY } from "@/src/core/policy/loader";
import type { Policy } from "@/src/core/policy/schema";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import { App, EXPORT_FAILED_NOTE, NOTICE_SEEN_IDS_KEY, PRIVACY_SENTENCE } from "@/src/ui/popup/App";
import { DIAGNOSTICS_UNAVAILABLE } from "@/src/ui/popup/DiagnosticsPanel";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 22);
const NOTICE_TEXT =
  "Profile lookups on X are paused while we adapt to a page change. Badges still work.";

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    schema: 1,
    version: 3,
    issuedAt: "2026-10-20T00:00:00Z",
    minExtensionVersion: "0.1.0",
    platforms: {},
    ...overrides,
  };
}

async function seedPolicy(cached: Policy, fetchedAt: number = NOW - 2 * DAY): Promise<void> {
  await fakeBrowser.storage.local.set({
    [POLICY_LKG_KEY]: { policy: cached, fetchedAt, kid: "t" },
  });
}

async function mount(): Promise<HTMLDivElement> {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  render(<App now={() => NOW} />, container);
  await vi.waitFor(() => expect(container.querySelector("[role=switch]")).not.toBeNull());
  return container;
}

const rowCaptions = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll(".bd-row .bd-caption")).map(
    (caption) => caption.textContent ?? "",
  );

const statusLine = (container: HTMLElement): string =>
  container.querySelector(".bd-head .bd-caption")?.textContent ?? "";

function switchNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button: HTMLButtonElement | null = container.querySelector(
    `[role=switch][aria-label="${name}"]`,
  );
  if (!button) throw new Error(`no switch named ${name}`);
  return button;
}

async function storedSettings(): Promise<Settings> {
  const stored: Record<string, unknown> = await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY);
  return stored[SETTINGS_STORAGE_KEY] as Settings;
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = "";
});

describe("popup App", () => {
  it("renders every platform on with lookups on before any policy was fetched", async () => {
    const container: HTMLDivElement = await mount();
    expect(statusLine(container)).toBe("Policy not fetched yet");
    expect(rowCaptions(container)).toEqual([
      "Badges on · lookups on",
      "Badges on · lookups on",
      "Badges on · lookups on",
      "Badges on · lookups on",
      "Never ask a platform for a profile",
      PRIVACY_SENTENCE,
    ]);
    expect(container.querySelector(".bd-notice")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Botdar");
    expect(container.textContent).toContain("Settings");
  });

  it("reflects the policy age, paused lookups and the notice", async () => {
    await seedPolicy(
      policy({
        platforms: { x: { enabled: true, tiers: { t2: false } } },
        notice: { id: "2026-10-a", text: NOTICE_TEXT, url: "https://example.com/notice" },
      }),
    );
    const container: HTMLDivElement = await mount();
    expect(statusLine(container)).toBe("Policy updated 2 days ago");
    expect(rowCaptions(container)[0]).toBe("Badges on · lookups paused");
    expect(rowCaptions(container)[1]).toBe("Badges on · lookups on");
    const notice: HTMLElement | null = container.querySelector(".bd-notice");
    expect(notice?.textContent).toContain(NOTICE_TEXT);
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/notice");
  });

  it("says badges are paused when the policy turned a platform off", async () => {
    await seedPolicy(policy({ platforms: { bluesky: { enabled: false } } }));
    const container: HTMLDivElement = await mount();
    expect(rowCaptions(container)[2]).toBe("Badges paused");
    expect(switchNamed(container, "Bluesky").getAttribute("aria-checked")).toBe("true");
  });

  it("hides a dismissed notice and remembers its id", async () => {
    await seedPolicy(policy({ notice: { id: "2026-10-a", text: NOTICE_TEXT } }));
    const container: HTMLDivElement = await mount();
    const dismiss: HTMLButtonElement | null = container.querySelector(".bd-notice button");
    dismiss?.click();
    await vi.waitFor(() => expect(container.querySelector(".bd-notice")).toBeNull());
    const stored: Record<string, unknown> =
      await fakeBrowser.storage.local.get(NOTICE_SEEN_IDS_KEY);
    expect(stored[NOTICE_SEEN_IDS_KEY]).toEqual(["2026-10-a"]);
    const remounted: HTMLDivElement = await mount();
    expect(remounted.querySelector(".bd-notice")).toBeNull();
  });

  it("reports a failed refresh while the cached copy stays in use", async () => {
    await seedPolicy(policy());
    await fakeBrowser.storage.local.set({
      [POLICY_LAST_ATTEMPT_KEY]: { at: NOW, ok: false, error: "http 500" },
    });
    const container: HTMLDivElement = await mount();
    expect(statusLine(container)).toBe("Policy update failed; using the last good copy");
  });

  it("saves platform and conservative-mode toggles and updates the captions", async () => {
    const container: HTMLDivElement = await mount();
    switchNamed(container, "X").click();
    await vi.waitFor(() => expect(rowCaptions(container)[0]).toBe("Badges off"));
    expect(switchNamed(container, "X").getAttribute("aria-checked")).toBe("false");
    expect((await storedSettings()).platforms).toEqual({
      x: false,
      reddit: true,
      bluesky: true,
      hackernews: true,
    });

    switchNamed(container, "Conservative mode").click();
    await vi.waitFor(() => expect(rowCaptions(container)[1]).toBe("Badges on · lookups off"));
    expect(await storedSettings()).toEqual({
      ...defaultSettings,
      platforms: { x: false, reddit: true, bluesky: true, hackernews: true },
      conservativeMode: true,
    });
  });

  it("opens the options page and closes itself from the Settings link", async () => {
    const openOptionsPage = vi.fn(async () => undefined);
    fakeBrowser.runtime.openOptionsPage = openOptionsPage;
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const container: HTMLDivElement = await mount();
    const settingsButton: HTMLButtonElement | undefined = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Settings");
    settingsButton?.click();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });

  describe("diagnostics section", () => {
    const STATS = {
      startedAt: NOW - 120_000,
      kinds: {
        post: { seen: 3, badged: 3, anchorMisses: 0 },
        comment: { seen: 11, badged: 0, anchorMisses: 11 },
        reply: { seen: 0, badged: 0, anchorMisses: 0 },
      },
      lookups: { started: 1, cached: 0, delivered: 1, empty: 0, rateLimited: 0, failed: 0 },
    };

    async function enableDeveloperMode(): Promise<void> {
      await fakeBrowser.storage.local.set({
        [SETTINGS_STORAGE_KEY]: { ...defaultSettings, developerMode: true },
      });
      const created = await fakeBrowser.windows.create({ focused: true });
      await fakeBrowser.tabs.create({
        url: "https://www.reddit.com/",
        active: true,
        windowId: created?.id,
      });
    }

    function answerTabMessages(): void {
      fakeBrowser.tabs.sendMessage = vi.fn(async (_tabId: number, message: unknown) => {
        const request = message as { type: string; anonymize?: boolean };
        if (request.type === "diagnostics.get") return { platform: "reddit", stats: STATS };
        return {
          html: "<!doctype html>\n<html></html>",
          fileName: request.anonymize
            ? "botdar-reddit-2026-10-22.html"
            : "botdar-reddit-2026-10-22-raw.html",
          identifiers: request.anonymize ? 7 : 0,
        };
      });
    }

    it("stays hidden until the setting is on", async () => {
      const container: HTMLDivElement = await mount();
      expect(container.querySelector(".bd-diagnostics")).toBeNull();
    });

    it("shows the active page's counts and saves an anonymised snapshot", async () => {
      await enableDeveloperMode();
      answerTabMessages();
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
      const container: HTMLDivElement = await mount();
      await vi.waitFor(() => expect(container.querySelector(".bd-table")).not.toBeNull());
      expect(container.querySelector(".bd-diagnostics .bd-caption")?.textContent).toBe(
        "Reddit · Counting since the page loaded, 2 min ago",
      );
      expect(container.querySelector(".bd-table__warn")?.textContent).toBe("11");

      const exportButton: HTMLButtonElement | null =
        container.querySelector(".bd-diagnostics .bd-btn");
      exportButton?.click();
      await vi.waitFor(() =>
        expect(container.textContent).toContain(
          "Saved botdar-reddit-2026-10-22.html (7 identifiers replaced)",
        ),
      );
      expect(click).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
      click.mockRestore();
    });

    it("explains when the active tab has no Botdar page and when an export fails", async () => {
      await enableDeveloperMode();
      fakeBrowser.tabs.sendMessage = vi.fn().mockRejectedValue(new Error("no receiver"));
      const container: HTMLDivElement = await mount();
      await vi.waitFor(() => expect(container.textContent).toContain(DIAGNOSTICS_UNAVAILABLE));
      const buttons: HTMLButtonElement[] = Array.from(
        container.querySelectorAll(".bd-diagnostics button"),
      );
      expect(buttons.every((button) => button.disabled)).toBe(true);

      answerTabMessages();
      const remounted: HTMLDivElement = await mount();
      await vi.waitFor(() => expect(remounted.querySelector(".bd-table")).not.toBeNull());
      fakeBrowser.tabs.sendMessage = vi.fn().mockRejectedValue(new Error("gone"));
      remounted.querySelector<HTMLButtonElement>(".bd-diagnostics .bd-btn")?.click();
      await vi.waitFor(() => expect(remounted.textContent).toContain(EXPORT_FAILED_NOTE));
    });
  });
});
