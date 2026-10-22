import { fakeBrowser } from "wxt/testing/fake-browser";
import { POLICY_LAST_ATTEMPT_KEY, POLICY_LKG_KEY } from "@/src/core/policy/loader";
import type { LastKnownGoodPolicy } from "@/src/core/policy/loader";
import {
  POLICY_NOT_FETCHED,
  POLICY_UPDATE_FAILED,
  describeAge,
  loadPolicyStatus,
  policyStatusLine,
} from "@/src/ui/policyStatus";
import type { PolicyStatus } from "@/src/ui/policyStatus";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 22);

const lastKnownGood = (fetchedAt: number): LastKnownGoodPolicy => ({
  policy: {
    schema: 1,
    version: 3,
    issuedAt: "2026-10-20T00:00:00Z",
    minExtensionVersion: "0.1.0",
    platforms: {},
  },
  fetchedAt,
  kid: "test",
});

beforeEach(() => {
  fakeBrowser.reset();
});

describe("describeAge", () => {
  it("counts whole days and never goes negative", () => {
    expect(describeAge(NOW, NOW)).toBe("today");
    expect(describeAge(NOW + DAY, NOW)).toBe("today");
    expect(describeAge(NOW - DAY + 1, NOW)).toBe("today");
    expect(describeAge(NOW - DAY, NOW)).toBe("1 day ago");
    expect(describeAge(NOW - 2.5 * DAY, NOW)).toBe("2 days ago");
    expect(describeAge(NOW - 30 * DAY, NOW)).toBe("30 days ago");
  });
});

describe("policyStatusLine", () => {
  it("reports no policy, a failed refresh, or the age of the cached copy", () => {
    const none: PolicyStatus = { lastKnownGood: null, lastAttempt: null };
    expect(policyStatusLine(none, NOW)).toBe(POLICY_NOT_FETCHED);
    const failed: PolicyStatus = {
      lastKnownGood: lastKnownGood(NOW - 2 * DAY),
      lastAttempt: { at: NOW, ok: false, error: "http 500" },
    };
    expect(policyStatusLine(failed, NOW)).toBe(POLICY_UPDATE_FAILED);
    const fresh: PolicyStatus = {
      lastKnownGood: lastKnownGood(NOW - 2 * DAY),
      lastAttempt: { at: NOW - 2 * DAY, ok: true },
    };
    expect(policyStatusLine(fresh, NOW)).toBe("Policy updated 2 days ago");
  });

  it("still says not fetched when the only attempt failed", () => {
    const status: PolicyStatus = { lastKnownGood: null, lastAttempt: { at: NOW, ok: false } };
    expect(policyStatusLine(status, NOW)).toBe(POLICY_NOT_FETCHED);
  });
});

describe("loadPolicyStatus", () => {
  it("reads the cached policy and the last attempt", async () => {
    await fakeBrowser.storage.local.set({
      [POLICY_LKG_KEY]: lastKnownGood(NOW - DAY),
      [POLICY_LAST_ATTEMPT_KEY]: { at: NOW, ok: false, error: "network: offline" },
    });
    const status: PolicyStatus = await loadPolicyStatus();
    expect(status.lastKnownGood?.policy.version).toBe(3);
    expect(status.lastAttempt).toEqual({ at: NOW, ok: false, error: "network: offline" });
  });

  it("treats missing or malformed data as absent", async () => {
    expect(await loadPolicyStatus()).toEqual({ lastKnownGood: null, lastAttempt: null });
    await fakeBrowser.storage.local.set({
      [POLICY_LKG_KEY]: { policy: { schema: 2 }, fetchedAt: NOW, kid: "test" },
      [POLICY_LAST_ATTEMPT_KEY]: { at: "yesterday", ok: "maybe" },
    });
    expect(await loadPolicyStatus()).toEqual({ lastKnownGood: null, lastAttempt: null });
  });
});
