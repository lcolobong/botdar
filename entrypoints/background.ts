export default defineBackground(() => {
  // The policy loader, alarms and settings broker land in later commits.
  browser.runtime.onInstalled.addListener(() => {
    console.warn("Botdar installed");
  });
});
