import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ConfigChangedBroadcast, EffectiveConfigByPlatform } from "@/src/core/messaging";
import {
  broadcastToTabs,
  sendToActiveTab,
  isEffectivePlatformConfig,
  isResponseFor,
  isRuntimeMessage,
  onRequest,
  sendRequest,
} from "@/src/core/messaging";
import type { EffectivePlatformConfig } from "@/src/core/types";

const xConfig: EffectivePlatformConfig = {
  platform: "x",
  enabled: true,
  tiers: { t1: true, t2: false },
  rateLimitPerMinute: 20,
  policyVersion: 3,
};

const configs: EffectiveConfigByPlatform = {
  x: xConfig,
  reddit: { ...xConfig, platform: "reddit" },
  bluesky: { ...xConfig, platform: "bluesky" },
};

describe("messaging type guards", () => {
  it("accepts a well-formed effective config and rejects malformed ones", () => {
    expect(isEffectivePlatformConfig(xConfig)).toBe(true);
    expect(isEffectivePlatformConfig({ ...xConfig, platform: "mastodon" })).toBe(false);
    expect(isEffectivePlatformConfig({ ...xConfig, tiers: { t1: true } })).toBe(false);
    expect(isEffectivePlatformConfig({ ...xConfig, rateLimitPerMinute: "20" })).toBe(false);
    expect(isEffectivePlatformConfig(null)).toBe(false);
  });

  it("accepts the diagnostics requests and rejects a snapshot request without the flag", () => {
    expect(isRuntimeMessage({ type: "diagnostics.get" })).toBe(true);
    expect(isRuntimeMessage({ type: "snapshot.export", anonymize: false })).toBe(true);
    expect(isRuntimeMessage({ type: "snapshot.export" })).toBe(false);
    expect(isResponseFor("diagnostics.get", { platform: "x", stats: { startedAt: 1 } })).toBe(
      false,
    );
    expect(isResponseFor("snapshot.export", { html: "", fileName: "a.html", identifiers: 0 })).toBe(
      true,
    );
  });

  it("narrows runtime messages by type and payload", () => {
    expect(isRuntimeMessage({ type: "config.get", platform: "reddit" })).toBe(true);
    expect(isRuntimeMessage({ type: "config.get", platform: "nope" })).toBe(false);
    expect(isRuntimeMessage({ type: "policy.refresh" })).toBe(true);
    expect(isRuntimeMessage({ type: "config.changed", configs })).toBe(true);
    expect(isRuntimeMessage({ type: "config.changed", configs: { x: xConfig } })).toBe(false);
    expect(
      isRuntimeMessage({ type: "config.changed", configs: { ...configs, reddit: xConfig } }),
    ).toBe(false);
    expect(isRuntimeMessage({ type: "unknown" })).toBe(false);
    expect(isRuntimeMessage("config.get")).toBe(false);
  });

  it("validates responses per request type", () => {
    expect(isResponseFor("config.get", { config: xConfig })).toBe(true);
    expect(isResponseFor("config.get", { config: {} })).toBe(false);
    expect(isResponseFor("policy.refresh", { ok: true })).toBe(true);
    expect(isResponseFor("policy.refresh", { ok: false, error: "offline" })).toBe(true);
    expect(isResponseFor("policy.refresh", { ok: "yes" })).toBe(false);
    expect(isResponseFor("config.changed", undefined)).toBe(true);
  });
});

describe("sendRequest and onRequest", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("routes a request to the handler of its type and returns the response", async () => {
    const handler = vi.fn(async (message: { platform: string }) => ({
      config: { ...xConfig, platform: message.platform } as EffectivePlatformConfig,
    }));
    const unsubscribe = onRequest("config.get", handler);

    const response = await sendRequest({ type: "config.get", platform: "x" });

    expect(response.config.platform).toBe("x");
    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ignores messages of another type", async () => {
    const configHandler = vi.fn(() => ({ config: xConfig }));
    const refreshHandler = vi.fn(() => ({ ok: true }));
    onRequest("config.get", configHandler);
    onRequest("policy.refresh", refreshHandler);

    await sendRequest({ type: "policy.refresh" });

    expect(configHandler).not.toHaveBeenCalled();
    expect(refreshHandler).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed response", async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ config: { platform: "x" } });
      return true;
    });

    await expect(sendRequest({ type: "config.get", platform: "x" })).rejects.toThrow(
      "Malformed response to config.get",
    );
  });

  it("never passes a malformed message to a handler", async () => {
    const handler = vi.fn(() => ({ config: xConfig }));
    onRequest("config.get", handler);
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse(undefined);
      return true;
    });

    await fakeBrowser.runtime.sendMessage({ type: "config.get", platform: 42 });
    await fakeBrowser.runtime.sendMessage("config.get");

    expect(handler).not.toHaveBeenCalled();
  });

  it("drops messages without a sender object", () => {
    const handler = vi.fn(() => ({ config: xConfig }));
    onRequest("config.get", handler);
    const sendResponse = vi.fn();

    fakeBrowser.runtime.onMessage.trigger(
      { type: "config.get", platform: "x" },
      undefined as never,
      sendResponse,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("responds with undefined when the handler throws", async () => {
    onRequest("config.get", () => {
      throw new Error("boom");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(sendRequest({ type: "config.get", platform: "x" })).rejects.toThrow(
      "Malformed response",
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("stops listening after unsubscribe", async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const unsubscribe = onRequest("policy.refresh", handler);
    unsubscribe();

    await expect(sendRequest({ type: "policy.refresh" })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("sendToActiveTab", () => {
  beforeEach(() => fakeBrowser.reset());

  // The fake has no window until one is created; the current-window filter needs one.
  async function openActiveTab(): Promise<number | undefined> {
    const created = await fakeBrowser.windows.create({ focused: true });
    const tab = await fakeBrowser.tabs.create({
      url: "https://www.reddit.com/",
      active: true,
      windowId: created?.id,
    });
    return tab.id;
  }

  it("sends to the active tab and validates the reply", async () => {
    const tabId: number | undefined = await openActiveTab();
    const sendMessage = vi.fn().mockResolvedValue({
      html: "<!doctype html>",
      fileName: "botdar-reddit-2026-10-25.html",
      identifiers: 3,
    });
    fakeBrowser.tabs.sendMessage = sendMessage;
    const reply = await sendToActiveTab({ type: "snapshot.export", anonymize: true });
    expect(sendMessage).toHaveBeenCalledWith(tabId, { type: "snapshot.export", anonymize: true });
    expect(reply.identifiers).toBe(3);
  });

  it("rejects when the reply is malformed or there is no active tab", async () => {
    await openActiveTab();
    fakeBrowser.tabs.sendMessage = vi.fn().mockResolvedValue({ stats: {} });
    await expect(sendToActiveTab({ type: "diagnostics.get" })).rejects.toThrow("Malformed");
    fakeBrowser.reset();
    await expect(sendToActiveTab({ type: "diagnostics.get" })).rejects.toThrow("No active tab");
  });
});

describe("broadcastToTabs", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("sends the broadcast to every tab and tolerates tabs without a receiver", async () => {
    await fakeBrowser.tabs.create({ url: "https://x.com/home" });
    await fakeBrowser.tabs.create({ url: "https://example.com" });
    const openTabs = await fakeBrowser.tabs.query({});
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error("Could not establish connection"))
      .mockResolvedValueOnce(undefined);
    fakeBrowser.tabs.sendMessage = sendMessage;
    const message: ConfigChangedBroadcast = { type: "config.changed", configs };

    await expect(broadcastToTabs(message)).resolves.toBeUndefined();

    expect(openTabs.length).toBeGreaterThanOrEqual(2);
    expect(sendMessage).toHaveBeenCalledTimes(openTabs.length);
    expect(sendMessage).toHaveBeenCalledWith(expect.any(Number), message);
  });
});
