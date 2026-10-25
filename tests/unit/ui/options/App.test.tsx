// @vitest-environment happy-dom
import { render } from "preact";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { listFeedback, recordFeedback } from "@/src/core/feedback";
import type { FeedbackInput } from "@/src/core/feedback";
import { POLICY_LKG_KEY } from "@/src/core/policy/loader";
import type { Policy } from "@/src/core/policy/schema";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import { App, FEEDBACK_FILE_NAME, PRIVACY_URL, feedbackCountLine } from "@/src/ui/options/App";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 22);

const cachedPolicy: Policy = {
  schema: 1,
  version: 3,
  issuedAt: "2026-10-20T00:00:00Z",
  minExtensionVersion: "0.1.0",
  platforms: {},
};

const feedback = (handle: string): FeedbackInput => ({
  platform: "x",
  handle,
  tier: "many",
  reasons: ["Account is 3 days old"],
  computedAt: NOW,
});

async function mount(): Promise<HTMLDivElement> {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  render(<App now={() => NOW} />, container);
  await vi.waitFor(() => expect(container.querySelector("[role=switch]")).not.toBeNull());
  return container;
}

function buttonNamed(container: HTMLElement, text: string): HTMLButtonElement {
  const button: HTMLButtonElement | undefined = Array.from(
    container.querySelectorAll("button"),
  ).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`no button named ${text}`);
  return button;
}

const headings = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll("h2")).map((heading) => heading.textContent ?? "");

const rowTitles = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll(".bd-row p")).map((title) => title.textContent ?? "");

const rowCaptions = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll(".bd-row .bd-caption")).map(
    (caption) => caption.textContent ?? "",
  );

async function storedSettings(): Promise<Settings> {
  const stored: Record<string, unknown> = await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY);
  return stored[SETTINGS_STORAGE_KEY] as Settings;
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = "";
});

describe("options App", () => {
  it("lays out the sections with the platform domains and the privacy footer", async () => {
    const container: HTMLDivElement = await mount();
    expect(headings(container)).toEqual([
      "Platforms",
      "Lookups",
      "Badges",
      "Developer",
      "Feedback",
      "Policy",
    ]);
    expect(rowTitles(container).slice(0, 3)).toEqual(["X", "Reddit", "Bluesky"]);
    expect(rowCaptions(container).slice(0, 3)).toEqual([
      "x.com and twitter.com",
      "reddit.com and old.reddit.com",
      "bsky.app",
    ]);
    expect(rowTitles(container)).toContain(feedbackCountLine(0));
    expect(rowTitles(container)).toContain("Policy not fetched yet");
    const privacy: HTMLAnchorElement | null = container.querySelector(`a[href="${PRIVACY_URL}"]`);
    expect(privacy?.textContent).toBe("Privacy");
    expect(container.textContent).toContain(
      "Nothing about the accounts you see leaves this browser.",
    );
  });

  it("persists label style, Reddit comment labels and Show Likely human", async () => {
    const container: HTMLDivElement = await mount();
    buttonNamed(container, "Sus scale").click();
    await vi.waitFor(() =>
      expect(buttonNamed(container, "Sus scale").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(buttonNamed(container, "Plain").getAttribute("aria-pressed")).toBe("false");
    expect((await storedSettings()).labelStyle).toBe("sus");

    buttonNamed(container, "Glyph and label").click();
    await vi.waitFor(async () =>
      expect((await storedSettings()).redditCommentLabels).toBe("label"),
    );

    const showLikelyHuman: HTMLButtonElement | null = container.querySelector(
      '[role=switch][aria-label="Show Likely human"]',
    );
    showLikelyHuman?.click();
    await vi.waitFor(async () => expect((await storedSettings()).showLikelyHuman).toBe(true));
    expect(await storedSettings()).toEqual({
      ...defaultSettings,
      labelStyle: "sus",
      redditCommentLabels: "label",
      showLikelyHuman: true,
    });
  });

  it("persists the developer diagnostics toggle, off by default", async () => {
    const container: HTMLDivElement = await mount();
    const toggle: HTMLButtonElement | null = container.querySelector(
      '[role=switch][aria-label="Diagnostics in the popup"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    toggle?.click();
    await vi.waitFor(async () => expect((await storedSettings()).developerMode).toBe(true));
  });

  it("counts the stored reports and exports them as botdar-feedback.json", async () => {
    await recordFeedback(feedback("one"));
    await recordFeedback(feedback("two"));
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:botdar/feedback");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(`${this.download}@${this.href}`);
    });

    const container: HTMLDivElement = await mount();
    expect(rowTitles(container)).toContain(feedbackCountLine(2));
    buttonNamed(container, "Export").click();
    await vi.waitFor(() =>
      expect(downloads).toEqual([`${FEEDBACK_FILE_NAME}@blob:botdar/feedback`]),
    );
    const blob: Blob | undefined = createObjectURL.mock.calls[0]?.[0] as Blob | undefined;
    expect(blob?.type).toBe("application/json");
    // The URL is revoked on a timer so a slow download can still open the blob.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:botdar/feedback"), {
      timeout: 15_000,
      interval: 500,
    });
    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  }, 20_000);

  it("clears feedback only after the confirmation step", async () => {
    await recordFeedback(feedback("one"));
    const container: HTMLDivElement = await mount();
    buttonNamed(container, "Clear").click();
    await vi.waitFor(() => expect(buttonNamed(container, "Confirm clear")).toBeDefined());
    expect(await listFeedback()).toHaveLength(1);
    expect(rowCaptions(container)).toContain("This removes every report from this device.");

    buttonNamed(container, "Cancel").click();
    await vi.waitFor(() => expect(buttonNamed(container, "Clear")).toBeDefined());
    expect(await listFeedback()).toHaveLength(1);

    buttonNamed(container, "Clear").click();
    await vi.waitFor(() => expect(buttonNamed(container, "Confirm clear")).toBeDefined());
    buttonNamed(container, "Confirm clear").click();
    await vi.waitFor(() => expect(rowTitles(container)).toContain(feedbackCountLine(0)));
    expect(await listFeedback()).toHaveLength(0);
  });

  it("describes the cached policy and refreshes it on Check now", async () => {
    await fakeBrowser.storage.local.set({
      [POLICY_LKG_KEY]: { policy: cachedPolicy, fetchedAt: NOW - 2 * DAY, kid: "t" },
    });
    const refreshed: Policy = { ...cachedPolicy, version: 4 };
    const requests: unknown[] = [];
    fakeBrowser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      requests.push(message);
      void fakeBrowser.storage.local
        .set({ [POLICY_LKG_KEY]: { policy: refreshed, fetchedAt: NOW, kid: "t" } })
        .then(() => sendResponse({ ok: true }));
      return true;
    });

    const container: HTMLDivElement = await mount();
    expect(rowTitles(container)).toContain("Version 3, signature verified");
    expect(rowCaptions(container)).toContain(
      "Fetched 2 days ago from lcolobong.github.io. It can only turn features off, never on.",
    );
    buttonNamed(container, "Check now").click();
    await vi.waitFor(() => expect(rowTitles(container)).toContain("Version 4, signature verified"));
    expect(requests).toEqual([{ type: "policy.refresh" }]);
    expect(rowCaptions(container)).toContain(
      "Fetched today from lcolobong.github.io. It can only turn features off, never on.",
    );
  });

  it("resets every setting to the defaults", async () => {
    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { ...defaultSettings, conservativeMode: true, labelStyle: "icon" },
    });
    const container: HTMLDivElement = await mount();
    expect(buttonNamed(container, "Icon only").getAttribute("aria-pressed")).toBe("true");
    buttonNamed(container, "Reset to defaults").click();
    await vi.waitFor(() =>
      expect(buttonNamed(container, "Plain").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(await storedSettings()).toEqual(defaultSettings);
  });
});
