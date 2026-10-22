import { fakeBrowser } from "wxt/testing/fake-browser";
import { ONBOARDING_PAGE, registerOnboardingOnInstall } from "@/src/background/onboarding";
import { ONBOARDING_SEEN_KEY } from "@/src/ui/onboarding/seen";

const ONBOARDING_URL = `chrome-extension://${fakeBrowser.runtime.id}/onboarding.html`;

async function openUrls(): Promise<(string | undefined)[]> {
  const tabs = await fakeBrowser.tabs.query({});
  return tabs.map((tab) => tab.url).filter((url) => url !== undefined);
}

beforeEach(() => {
  fakeBrowser.reset();
  registerOnboardingOnInstall();
});

describe("registerOnboardingOnInstall", () => {
  it("opens the onboarding page in a tab on a fresh install", async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "install" });
    await vi.waitFor(async () => expect(await openUrls()).toEqual([ONBOARDING_URL]));
    expect(fakeBrowser.runtime.getURL(ONBOARDING_PAGE)).toBe(ONBOARDING_URL);
  });

  it("stays quiet on updates and browser upgrades", async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "update", previousVersion: "0.0.1" });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "chrome_update" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await openUrls()).toEqual([]);
  });

  it("does not reopen the page once it was finished", async () => {
    await fakeBrowser.storage.local.set({ [ONBOARDING_SEEN_KEY]: true });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "install" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await openUrls()).toEqual([]);
  });
});
