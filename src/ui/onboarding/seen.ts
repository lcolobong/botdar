import { browser } from "wxt/browser";

/** Set once the user finishes the first-run page; the background opens the page only while unset. */
export const ONBOARDING_SEEN_KEY = "onboarding.seen";

export async function hasSeenOnboarding(): Promise<boolean> {
  const stored: Record<string, unknown> = await browser.storage.local.get(ONBOARDING_SEEN_KEY);
  return stored[ONBOARDING_SEEN_KEY] === true;
}

export async function markOnboardingSeen(): Promise<void> {
  await browser.storage.local.set({ [ONBOARDING_SEEN_KEY]: true });
}
