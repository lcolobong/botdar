/**
 * The background's side of the config messaging: answers `config.get` and `policy.refresh`, and
 * broadcasts `config.changed` to every tab whenever the settings or the cached policy change in
 * storage. Watching storage rather than the writers covers every path that updates either key,
 * including the alarm-driven policy refresh and the options page.
 */
import { browser } from "wxt/browser";
import { broadcastToTabs, onRequest } from "@/src/core/messaging";
import type { EffectiveConfigByPlatform, PolicyRefreshResponse } from "@/src/core/messaging";
import { POLICY_LKG_KEY, getEffectiveConfig, refreshPolicy } from "@/src/core/policy/loader";
import type { PolicyAttempt } from "@/src/core/policy/loader";
import { defaultWeights } from "@/src/core/scoring/weights";
import { SETTINGS_STORAGE_KEY } from "@/src/core/settings";

const BROADCAST_KEYS: readonly string[] = [SETTINGS_STORAGE_KEY, POLICY_LKG_KEY];

export async function currentConfigs(): Promise<EffectiveConfigByPlatform> {
  return (await getEffectiveConfig(defaultWeights)).platforms;
}

async function refreshPolicyNow(): Promise<PolicyRefreshResponse> {
  const attempt: PolicyAttempt = await refreshPolicy();
  return attempt.error === undefined
    ? { ok: attempt.ok }
    : { ok: attempt.ok, error: attempt.error };
}

/** Registers the handlers and the storage watcher; returns the function that removes them. */
export function registerConfigBroker(): () => void {
  const stopConfigGet: () => void = onRequest("config.get", async ({ platform }) => ({
    config: (await currentConfigs())[platform],
  }));
  const stopPolicyRefresh: () => void = onRequest("policy.refresh", refreshPolicyNow);
  const onStorageChanged = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== "local" || !BROADCAST_KEYS.some((key) => key in changes)) return;
    void currentConfigs().then((configs) => broadcastToTabs({ type: "config.changed", configs }));
  };
  browser.storage.onChanged.addListener(onStorageChanged);
  return () => {
    stopConfigGet();
    stopPolicyRefresh();
    browser.storage.onChanged.removeListener(onStorageChanged);
  };
}
