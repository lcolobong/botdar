import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  POLICY_LAST_ATTEMPT_KEY,
  POLICY_LKG_KEY,
  POLICY_REFRESH_ALARM,
  POLICY_URL,
  getEffectiveConfig,
  loadLastKnownGood,
  refreshPolicy,
  registerPolicyRefresh,
  schedulePolicyRefresh,
} from "../../../src/core/policy/loader.ts";
import type { LastKnownGoodPolicy, PolicyAttempt } from "../../../src/core/policy/loader.ts";
import type { EffectiveConfig, PlatformWeights } from "../../../src/core/policy/merge.ts";
import type { Policy } from "../../../src/core/policy/schema.ts";
import type { SignedPolicyEnvelope } from "../../../src/core/policy/verify.ts";
import { SETTINGS_STORAGE_KEY, defaultSettings } from "../../../src/core/settings.ts";
import type { PlatformId } from "../../../src/core/types.ts";

interface TestKeypair {
  kid: string;
  publicJwk: JsonWebKey;
  privateKeyPem: string;
}

const testKeypair: TestKeypair = JSON.parse(
  readFileSync(new URL("../../fixtures/policy/test-keypair.json", import.meta.url), "utf8"),
) as TestKeypair;

// The loader trusts the baked keys; the tests sign with the throwaway fixture key instead.
vi.mock("../../../src/core/policy/publicKey.ts", async () => {
  const { readFileSync: read } = await import("node:fs");
  const keypair: TestKeypair = JSON.parse(
    read(new URL("../../fixtures/policy/test-keypair.json", import.meta.url), "utf8"),
  ) as TestKeypair;
  return { trustedKeys: { [keypair.kid]: keypair.publicJwk } };
});

function policy(version: number, platforms: Policy["platforms"] = {}): Policy {
  return {
    schema: 1,
    version,
    issuedAt: "2026-10-22T00:00:00Z",
    minExtensionVersion: "0.1.0",
    platforms,
  };
}

function envelopeFor(payload: unknown): SignedPolicyEnvelope {
  const text: string = JSON.stringify(payload);
  const signature: Buffer = sign("sha256", Buffer.from(text, "utf8"), {
    key: createPrivateKey(testKeypair.privateKeyPem),
    dsaEncoding: "ieee-p1363",
  });
  return {
    alg: "ES256",
    kid: testKeypair.kid,
    payload: text,
    sig: signature.toString("base64url"),
  };
}

function serve(body: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock: ReturnType<typeof vi.fn> = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function storedLkg(): Promise<unknown> {
  const stored: Record<string, unknown> = await fakeBrowser.storage.local.get(POLICY_LKG_KEY);
  return stored[POLICY_LKG_KEY];
}

async function storedAttempt(): Promise<PolicyAttempt> {
  const stored: Record<string, unknown> =
    await fakeBrowser.storage.local.get(POLICY_LAST_ATTEMPT_KEY);
  return stored[POLICY_LAST_ATTEMPT_KEY] as PolicyAttempt;
}

async function cacheVersion(version: number): Promise<LastKnownGoodPolicy> {
  const cached: LastKnownGoodPolicy = {
    policy: policy(version, { x: { enabled: false } }),
    fetchedAt: 1_000,
    kid: testKeypair.kid,
  };
  await fakeBrowser.storage.local.set({ [POLICY_LKG_KEY]: cached });
  return cached;
}

function weights(): Record<PlatformId, PlatformWeights> {
  const platform = (): PlatformWeights => ({
    prior: -2.5,
    thresholds: { some: 0.3, many: 0.6 },
    features: {},
  });
  return { x: platform(), reddit: platform(), bluesky: platform(), hackernews: platform() };
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("refreshPolicy", () => {
  it("fetches without caching, verifies, validates and stores the policy as last-known-good", async () => {
    const fetchMock: ReturnType<typeof vi.fn> = serve(JSON.stringify(envelopeFor(policy(2))));
    const before: number = Date.now();
    const attempt: PolicyAttempt = await refreshPolicy();
    expect(fetchMock).toHaveBeenCalledWith(POLICY_URL, { cache: "no-store" });
    expect(attempt).toEqual({ at: expect.any(Number), ok: true });
    expect(attempt.at).toBeGreaterThanOrEqual(before);
    expect(await storedLkg()).toEqual({
      policy: policy(2),
      fetchedAt: attempt.at,
      kid: testKeypair.kid,
    });
    expect(await storedAttempt()).toEqual(attempt);
  });

  it("accepts a re-signed policy with the same version", async () => {
    await cacheVersion(2);
    serve(JSON.stringify(envelopeFor(policy(2))));
    expect((await refreshPolicy()).ok).toBe(true);
    expect(await loadLastKnownGood()).toMatchObject({ policy: policy(2) });
  });

  describe("leaves the last-known-good untouched", () => {
    it.each([
      [
        "network failure",
        (): void =>
          void vi.stubGlobal(
            "fetch",
            vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
          ),
        /^network: Failed to fetch/,
      ],
      ["http error", (): void => void serve("not found", 404), /^http 404/],
      ["unparseable body", (): void => void serve("<html>"), /^parse:/],
      [
        "malformed envelope",
        (): void => void serve(JSON.stringify({ alg: "none" })),
        /^signature: envelope.alg/,
      ],
      [
        "bad signature",
        (): void =>
          void serve(
            JSON.stringify({ ...envelopeFor(policy(5)), payload: JSON.stringify(policy(6)) }),
          ),
        /^signature: signature does not match/,
      ],
      [
        "unknown kid",
        (): void => void serve(JSON.stringify({ ...envelopeFor(policy(5)), kid: "2099-01" })),
        /^signature: unknown kid/,
      ],
      [
        "bad schema",
        (): void =>
          void serve(
            JSON.stringify(envelopeFor({ ...policy(5), platforms: { x: { enabled: "yes" } } })),
          ),
        /^schema: policy.platforms.x.enabled/,
      ],
      [
        "rollback",
        (): void => void serve(JSON.stringify(envelopeFor(policy(1)))),
        /^rollback: version 1 is older than the cached version 2/,
      ],
    ])("on %s", async (_name, arrange, error) => {
      const cached: LastKnownGoodPolicy = await cacheVersion(2);
      arrange();
      const attempt: PolicyAttempt = await refreshPolicy();
      expect(attempt.ok).toBe(false);
      expect(attempt.error).toMatch(error);
      expect(await storedLkg()).toEqual(cached);
      expect(await storedAttempt()).toEqual(attempt);
    });
  });
});

describe("loadLastKnownGood", () => {
  it("returns null when nothing is cached", async () => {
    expect(await loadLastKnownGood()).toBeNull();
  });

  it.each([
    ["not an object", "lkg"],
    ["missing fetchedAt", { policy: policy(1), kid: "k" }],
    ["invalid policy", { policy: { schema: 2 }, fetchedAt: 1, kid: "k" }],
  ])("treats corrupt storage (%s) as no cached policy", async (_name, cached) => {
    await fakeBrowser.storage.local.set({ [POLICY_LKG_KEY]: cached });
    expect(await loadLastKnownGood()).toBeNull();
  });
});

describe("getEffectiveConfig", () => {
  it("returns the build defaults with no cached policy and default settings", async () => {
    const effective: EffectiveConfig = await getEffectiveConfig(weights());
    expect(effective.policyVersion).toBe(0);
    expect(effective.platforms.x).toMatchObject({ enabled: true, tiers: { t1: true, t2: true } });
  });

  it("layers the cached policy and then the settings", async () => {
    await cacheVersion(3);
    await fakeBrowser.storage.local.set({
      [SETTINGS_STORAGE_KEY]: { ...defaultSettings, conservativeMode: true },
    });
    const effective: EffectiveConfig = await getEffectiveConfig(weights());
    expect(effective.policyVersion).toBe(3);
    expect(effective.platforms.x.enabled).toBe(false);
    expect(effective.platforms.reddit.tiers).toEqual({ t1: true, t2: false });
  });
});

describe("schedulePolicyRefresh", () => {
  it("registers the daily alarm once with a jittered first delay", async () => {
    await schedulePolicyRefresh();
    await schedulePolicyRefresh();
    const alarms: { name: string; scheduledTime: number; periodInMinutes?: number }[] =
      await fakeBrowser.alarms.getAll();
    expect(alarms).toHaveLength(1);
    expect(alarms[0]?.name).toBe(POLICY_REFRESH_ALARM);
    expect(alarms[0]?.periodInMinutes).toBe(1440);
    const delayMinutes: number = ((alarms[0]?.scheduledTime ?? 0) - Date.now()) / 60_000;
    expect(delayMinutes).toBeGreaterThanOrEqual(1);
    expect(delayMinutes).toBeLessThanOrEqual(31);
  });
});

describe("registerPolicyRefresh", () => {
  it("refreshes and schedules on install and on startup, and refreshes when the alarm fires", async () => {
    const fetchMock: ReturnType<typeof vi.fn> = serve(JSON.stringify(envelopeFor(policy(2))));
    registerPolicyRefresh();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "install" });
    await fakeBrowser.runtime.onStartup.trigger();
    await fakeBrowser.alarms.onAlarm.trigger({
      name: "unrelated",
      scheduledTime: Date.now(),
      persistAcrossSessions: true,
    });
    await fakeBrowser.alarms.onAlarm.trigger({
      name: POLICY_REFRESH_ALARM,
      scheduledTime: Date.now(),
      persistAcrossSessions: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(await fakeBrowser.alarms.getAll()).toHaveLength(1);
  });
});
