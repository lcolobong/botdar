// @vitest-environment happy-dom
import { render } from "preact";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { SETTINGS_STORAGE_KEY } from "@/src/core/settings";
import type { Settings } from "@/src/core/settings";
import { App } from "@/src/ui/onboarding/App";
import { ONBOARDING_SEEN_KEY, hasSeenOnboarding } from "@/src/ui/onboarding/seen";

function mount(): HTMLDivElement {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  render(<App />, container);
  return container;
}

const headline = (container: HTMLElement): string =>
  container.querySelector("h1")?.textContent ?? "";

function primaryButton(container: HTMLElement): HTMLButtonElement {
  const button: HTMLButtonElement | null = container.querySelector(".bd-panel__foot button");
  if (!button) throw new Error("no primary button");
  return button;
}

/** Preact re-renders on a microtask; a macrotask turn lets the click land in the DOM. */
async function advance(container: HTMLElement): Promise<void> {
  primaryButton(container).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const activeDot = (container: HTMLElement): number =>
  Array.from(container.querySelectorAll(".bd-dots i")).findIndex((dot) =>
    dot.classList.contains("bd-dots__on"),
  );

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = "";
});

describe("onboarding App", () => {
  it("opens on the badge panel with the real badges, No read included", () => {
    const container: HTMLDivElement = mount();
    expect(headline(container)).toBe("A badge on every author");
    const badges: string[] = Array.from(container.querySelectorAll("button.bd-badge")).map(
      (badge) => badge.getAttribute("aria-label") ?? "",
    );
    expect(badges).toEqual(["Likely bot", "Unsure", "Declared bot", "Likely human", "No read"]);
    const tiers: string[] = Array.from(container.querySelectorAll(".bd-tier")).map(
      (tier) => tier.textContent ?? "",
    );
    expect(tiers[0]).toContain("Several independent patterns common in automated accounts");
    expect(tiers[3]).toContain("Nothing stands out. Turn it off in settings");
    expect(tiers[4]).toContain("Too little to go on yet; the card says why");
    expect(primaryButton(container).textContent).toBe("Next");
    expect(activeDot(container)).toBe(0);
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Step 1 of 3");
  });

  it("steps through the privacy panel to the controls panel", async () => {
    const container: HTMLDivElement = mount();
    await advance(container);
    expect(headline(container)).toBe("Computed on this device");
    const blocks: string[] = Array.from(container.querySelectorAll(".bd-block strong")).map(
      (block) => block.textContent ?? "",
    );
    expect(blocks).toEqual(["What it reads:", "What leaves your browser:", "What it never does:"]);
    expect(container.textContent).toContain(
      "an author's name, sent only to the platform's site or public API for their public profile; nothing goes to us.",
    );
    expect(container.textContent).toContain(
      "Nothing is sent to us; lookups go only to the platform.",
    );
    expect(activeDot(container)).toBe(1);

    await advance(container);
    expect(headline(container)).toBe("Turn it down any time");
    expect(container.textContent).toContain(
      "Turn X, Reddit, Bluesky or Hacker News off from the toolbar popup",
    );
    expect(primaryButton(container).textContent).toBe("Done");
    expect(activeDot(container)).toBe(2);
  });

  it("drives the live conservative-mode toggle on the last panel", async () => {
    const container: HTMLDivElement = mount();
    await advance(container);
    await advance(container);
    const toggle = (): HTMLButtonElement | null => container.querySelector("[role=switch]");
    await vi.waitFor(() => expect(toggle()?.disabled).toBe(false));
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");
    toggle()?.click();
    await vi.waitFor(() => expect(toggle()?.getAttribute("aria-checked")).toBe("true"));
    const stored: Record<string, unknown> =
      await fakeBrowser.storage.local.get(SETTINGS_STORAGE_KEY);
    expect((stored[SETTINGS_STORAGE_KEY] as Settings).conservativeMode).toBe(true);
  });

  it("marks onboarding as seen and closes its tab on Done", async () => {
    const tab = await fakeBrowser.tabs.create({
      url: "chrome-extension://x/onboarding.html",
      active: true,
    });
    // The fake's remove looks the window up by the tab id and throws; the spy stands in for it.
    const remove = vi.spyOn(fakeBrowser.tabs, "remove").mockResolvedValue(undefined);
    const container: HTMLDivElement = mount();
    await advance(container);
    await advance(container);
    expect(await hasSeenOnboarding()).toBe(false);
    await advance(container);
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(tab.id));
    expect(await hasSeenOnboarding()).toBe(true);
    const stored: Record<string, unknown> =
      await fakeBrowser.storage.local.get(ONBOARDING_SEEN_KEY);
    expect(stored[ONBOARDING_SEEN_KEY]).toBe(true);
    remove.mockRestore();
  });

  it("falls back to closing the window when it is not in a tab", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const container: HTMLDivElement = mount();
    await advance(container);
    await advance(container);
    await advance(container);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(await hasSeenOnboarding()).toBe(true);
    close.mockRestore();
  });
});
