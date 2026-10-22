import { browser } from "wxt/browser";
import { hasSeenOnboarding } from "@/src/ui/onboarding/seen";

export const ONBOARDING_PAGE = "/onboarding.html";

export async function openOnboardingUnlessSeen(): Promise<void> {
  if (await hasSeenOnboarding()) return;
  await browser.tabs.create({ url: browser.runtime.getURL(ONBOARDING_PAGE) });
}

/** Opens the first-run page on a fresh install only; updates and browser upgrades stay quiet. */
export function registerOnboardingOnInstall(): void {
  browser.runtime.onInstalled.addListener((details: { reason: string }) => {
    if (details.reason === "install") void openOnboardingUnlessSeen();
  });
}
