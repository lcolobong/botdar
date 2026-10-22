import { fakeBrowser } from "wxt/testing/fake-browser";

describe("test harness", () => {
  it("provides a fake browser with storage", async () => {
    await fakeBrowser.storage.local.set({ smoke: 1 });
    const stored: Record<string, unknown> = await fakeBrowser.storage.local.get("smoke");
    expect(stored.smoke).toBe(1);
  });
});
