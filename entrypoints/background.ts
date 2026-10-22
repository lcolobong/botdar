import { registerPolicyRefresh } from "../src/core/policy/loader.ts";

export default defineBackground(() => {
  // The settings broker and config.get/config.changed messaging land in later commits.
  browser.runtime.onInstalled.addListener(() => {
    console.warn("Botdar installed");
  });
  registerPolicyRefresh();
});
