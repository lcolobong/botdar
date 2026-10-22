/**
 * Fetches, verifies and caches the signed policy in the service worker, with last-known-good
 * semantics: any failure (network, signature, schema, rollback) leaves `policy.lkg` untouched and
 * only records `policy.lastAttempt`. With no cached policy the build defaults apply, so the
 * extension never depends on the file being reachable (ADR-0007).
 */
import { browser } from "wxt/browser";
import { applySettings, loadSettings } from "../settings.ts";
import type { Settings } from "../settings.ts";
import type { PlatformId } from "../types.ts";
import { buildDefaults } from "./defaults.ts";
import { applyPolicy } from "./merge.ts";
import type { EffectiveConfig, PlatformWeights } from "./merge.ts";
import { trustedKeys } from "./publicKey.ts";
import { PolicyValidationError, validatePolicy } from "./schema.ts";
import type { Policy } from "./schema.ts";
import { PolicySignatureError, parseEnvelope, verifyEnvelope } from "./verify.ts";
import type { SignedPolicyEnvelope } from "./verify.ts";

export const POLICY_URL = "https://lcolobong.github.io/botdar/policy/v1.json";
export const POLICY_REFRESH_ALARM = "policy-refresh";
export const POLICY_LKG_KEY = "policy.lkg";
export const POLICY_LAST_ATTEMPT_KEY = "policy.lastAttempt";

const REFRESH_PERIOD_MINUTES = 1440;
/** The first fire is spread over half an hour so a release does not hit the host all at once. */
const FIRST_DELAY_JITTER_MINUTES = 30;
/** Chrome clamps shorter delays and logs a warning, so the jitter sits on top of one minute. */
const FIRST_DELAY_BASE_MINUTES = 1;
const MAX_RESPONSE_BYTES = 512 * 1024;

export interface LastKnownGoodPolicy {
  policy: Policy;
  /** Epoch milliseconds. */
  fetchedAt: number;
  kid: string;
}

export interface PolicyAttempt {
  /** Epoch milliseconds. */
  at: number;
  ok: boolean;
  error?: string;
}

class PolicyRollbackError extends Error {
  constructor(fetched: number, cached: number) {
    super(`version ${fetched} is older than the cached version ${cached}`);
    this.name = "PolicyRollbackError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored data is untrusted: anything that does not validate reads as "no cached policy". */
export async function loadLastKnownGood(): Promise<LastKnownGoodPolicy | null> {
  const stored: Record<string, unknown> = await browser.storage.local.get(POLICY_LKG_KEY);
  const cached: unknown = stored[POLICY_LKG_KEY];
  if (!isRecord(cached) || typeof cached.fetchedAt !== "number" || typeof cached.kid !== "string") {
    return null;
  }
  try {
    return { policy: validatePolicy(cached.policy), fetchedAt: cached.fetchedAt, kid: cached.kid };
  } catch {
    return null;
  }
}

async function fetchVerifiedPolicy(): Promise<{ policy: Policy; kid: string }> {
  const response: Response = await fetch(POLICY_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`http ${response.status}`);
  const body: string = await response.text();
  if (body.length > MAX_RESPONSE_BYTES)
    throw new Error(`response larger than ${MAX_RESPONSE_BYTES}`);
  const envelope: SignedPolicyEnvelope = parseEnvelope(JSON.parse(body));
  const payload: string = await verifyEnvelope(envelope, trustedKeys);
  return { policy: validatePolicy(JSON.parse(payload)), kid: envelope.kid };
}

function describeFailure(error: unknown): string {
  if (error instanceof PolicySignatureError) return `signature: ${error.message}`;
  if (error instanceof PolicyValidationError) return `schema: ${error.message}`;
  if (error instanceof PolicyRollbackError) return `rollback: ${error.message}`;
  if (error instanceof SyntaxError) return `parse: ${error.message}`;
  if (error instanceof TypeError) return `network: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export async function refreshPolicy(): Promise<PolicyAttempt> {
  const at: number = Date.now();
  let attempt: PolicyAttempt;
  try {
    const cached: LastKnownGoodPolicy | null = await loadLastKnownGood();
    const { policy, kid } = await fetchVerifiedPolicy();
    if (cached !== null && policy.version < cached.policy.version) {
      throw new PolicyRollbackError(policy.version, cached.policy.version);
    }
    const lastKnownGood: LastKnownGoodPolicy = { policy, fetchedAt: at, kid };
    await browser.storage.local.set({ [POLICY_LKG_KEY]: lastKnownGood });
    attempt = { at, ok: true };
  } catch (error) {
    attempt = { at, ok: false, error: describeFailure(error) };
  }
  await browser.storage.local.set({ [POLICY_LAST_ATTEMPT_KEY]: attempt });
  return attempt;
}

/** Build defaults narrowed by the cached policy, then by the user's settings. */
export async function getEffectiveConfig<W extends PlatformWeights>(
  weightsByPlatform: Record<PlatformId, W>,
): Promise<EffectiveConfig<W>> {
  const [cached, settings]: [LastKnownGoodPolicy | null, Settings] = await Promise.all([
    loadLastKnownGood(),
    loadSettings(),
  ]);
  return applySettings(
    applyPolicy(buildDefaults, weightsByPlatform, cached?.policy ?? null),
    settings,
  );
}

/** Creates the daily alarm once; an existing alarm keeps its schedule across worker restarts. */
export async function schedulePolicyRefresh(): Promise<void> {
  const existing: unknown = await browser.alarms.get(POLICY_REFRESH_ALARM);
  if (existing !== undefined) return;
  await browser.alarms.create(POLICY_REFRESH_ALARM, {
    periodInMinutes: REFRESH_PERIOD_MINUTES,
    delayInMinutes: FIRST_DELAY_BASE_MINUTES + Math.random() * FIRST_DELAY_JITTER_MINUTES,
  });
}

/** Refreshes on install and browser start, schedules the alarm, and refreshes when it fires. */
export function registerPolicyRefresh(): void {
  const refreshNow = (): void => {
    void schedulePolicyRefresh();
    void refreshPolicy();
  };
  browser.runtime.onInstalled.addListener(refreshNow);
  browser.runtime.onStartup.addListener(refreshNow);
  browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === POLICY_REFRESH_ALARM) void refreshPolicy();
  });
}
