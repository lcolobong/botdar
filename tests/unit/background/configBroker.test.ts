import type { Mock } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { registerConfigBroker } from "@/src/background/configBroker";
import { sendRequest } from "@/src/core/messaging";
import type { ConfigChangedBroadcast } from "@/src/core/messaging";
import { POLICY_LAST_ATTEMPT_KEY, POLICY_LKG_KEY } from "@/src/core/policy/loader";
import type { Policy } from "@/src/core/policy/schema";
import { defaultSettings, saveSettings } from "@/src/core/settings";

const cachedPolicy: Policy = {
  schema: 1,
  version: 7,
  issuedAt: "2026-10-20T00:00:00Z",
  minExtensionVersion: "0.1.0",
  platforms: { reddit: { enabled: true, tiers: { t2: false } } },
};

type TabSendMessage = (tabId: number, message: unknown) => Promise<void>;

let stopBroker: () => void = () => undefined;
let sendMessage: Mock<TabSendMessage>;

/** The fake browser starts with one open tab, so every broadcast is one send. */
const broadcasts = (): ConfigChangedBroadcast[] =>
  sendMessage.mock.calls.map((call) => call[1] as ConfigChangedBroadcast);

beforeEach(() => {
  fakeBrowser.reset();
  sendMessage = vi.fn<TabSendMessage>().mockResolvedValue(undefined);
  fakeBrowser.tabs.sendMessage = sendMessage;
  stopBroker = registerConfigBroker();
});

afterEach(() => {
  stopBroker();
  vi.unstubAllGlobals();
});

describe("config.get", () => {
  it("answers with the effective config for the platform", async () => {
    await fakeBrowser.storage.local.set({
      [POLICY_LKG_KEY]: { policy: cachedPolicy, fetchedAt: 1, kid: "t" },
    });
    const { config } = await sendRequest({ type: "config.get", platform: "reddit" });
    expect(config).toMatchObject({
      platform: "reddit",
      enabled: true,
      tiers: { t1: true, t2: false },
      policyVersion: 7,
    });
  });
});

describe("config.changed", () => {
  it("broadcasts the recomputed configs after a settings change", async () => {
    await saveSettings({
      ...defaultSettings,
      platforms: { x: false, reddit: true, bluesky: true, hackernews: true, youtube: true },
    });
    await vi.waitFor(() => expect(broadcasts()).toHaveLength(1));
    const [broadcast] = broadcasts();
    expect(broadcast?.type).toBe("config.changed");
    expect(broadcast?.configs.x.enabled).toBe(false);
    expect(broadcast?.configs.reddit.enabled).toBe(true);
    const [openTab] = await fakeBrowser.tabs.query({});
    expect(sendMessage.mock.calls[0]?.[0]).toBe(openTab?.id);
  });

  it("broadcasts after the cached policy changes", async () => {
    await fakeBrowser.storage.local.set({
      [POLICY_LKG_KEY]: { policy: cachedPolicy, fetchedAt: 1, kid: "t" },
    });
    await vi.waitFor(() => expect(broadcasts()).toHaveLength(1));
    expect(broadcasts()[0]?.configs.reddit.tiers.t2).toBe(false);
    expect(broadcasts()[0]?.configs.x.policyVersion).toBe(7);
  });

  it("ignores other keys and stops after unregistering", async () => {
    await fakeBrowser.storage.local.set({ [POLICY_LAST_ATTEMPT_KEY]: { at: 1, ok: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broadcasts()).toHaveLength(0);
    stopBroker();
    await saveSettings({ ...defaultSettings, conservativeMode: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broadcasts()).toHaveLength(0);
  });
});

describe("policy.refresh", () => {
  it("runs a refresh and reports the attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const response = await sendRequest({ type: "policy.refresh" });
    expect(response).toEqual({ ok: false, error: "network: Failed to fetch" });
    const stored: Record<string, unknown> =
      await fakeBrowser.storage.local.get(POLICY_LAST_ATTEMPT_KEY);
    expect(stored[POLICY_LAST_ATTEMPT_KEY]).toMatchObject({ ok: false });
  });
});
