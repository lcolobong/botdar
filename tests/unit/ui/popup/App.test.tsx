// @vitest-environment happy-dom
import { render } from "preact";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { POLICY_LAST_ATTEMPT_KEY, POLICY_LKG_KEY } from "@/src/core/policy/loader";
import type { Policy } from "@/src/core/policy/schema";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import { App, NOTICE_SEEN_IDS_KEY, PRIVACY_SENTENCE } from "@/src/ui/popup/App";

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
    expect((await storedSettings()).platforms).toEqual({ x: false, reddit: true, bluesky: true });

    switchNamed(container, "Conservative mode").click();
    await vi.waitFor(() => expect(rowCaptions(container)[1]).toBe("Badges on · lookups off"));
    expect(await storedSettings()).toEqual({
      ...defaultSettings,
      platforms: { x: false, reddit: true, bluesky: true },
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
});
