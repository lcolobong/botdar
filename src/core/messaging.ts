/**
 * Typed runtime messaging between content scripts and the background service worker.
 *
 * Every incoming message is treated as untrusted data and narrowed with type guards before a handler
 * sees it: `runtime.onMessage` only fires for this extension's own contexts, but a shape check costs
 * nothing and keeps a malformed message from reaching privileged code.
 */

import type { Browser } from "wxt/browser";
import { browser } from "wxt/browser";
import type { EffectivePlatformConfig, PlatformId } from "./types";

export type EffectiveConfigByPlatform = Record<PlatformId, EffectivePlatformConfig>;

export interface ConfigGetRequest {
  type: "config.get";
  platform: PlatformId;
}

export interface ConfigGetResponse {
  config: EffectivePlatformConfig;
}

export interface PolicyRefreshRequest {
  type: "policy.refresh";
}

export interface PolicyRefreshResponse {
  ok: boolean;
  error?: string;
}

/** Sent by the background to every tab after a policy refresh or a settings change. */
export interface ConfigChangedBroadcast {
  type: "config.changed";
  configs: EffectiveConfigByPlatform;
}

export type RuntimeMessage = ConfigGetRequest | PolicyRefreshRequest | ConfigChangedBroadcast;
export type RuntimeMessageType = RuntimeMessage["type"];
export type MessageOf<T extends RuntimeMessageType> = Extract<RuntimeMessage, { type: T }>;

export interface ResponseByType {
  "config.get": ConfigGetResponse;
  "policy.refresh": PolicyRefreshResponse;
  "config.changed": undefined;
}

export type RequestHandler<T extends RuntimeMessageType> = (
  message: MessageOf<T>,
  sender: Browser.runtime.MessageSender,
) => ResponseByType[T] | Promise<ResponseByType[T]>;

const PLATFORM_IDS: readonly PlatformId[] = ["x", "reddit", "bluesky"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isPlatformId = (value: unknown): value is PlatformId =>
  typeof value === "string" && (PLATFORM_IDS as readonly string[]).includes(value);

export function isEffectivePlatformConfig(value: unknown): value is EffectivePlatformConfig {
  if (!isRecord(value) || !isRecord(value.tiers)) {
    return false;
  }
  return (
    isPlatformId(value.platform) &&
    typeof value.enabled === "boolean" &&
    typeof value.tiers.t1 === "boolean" &&
    typeof value.tiers.t2 === "boolean" &&
    typeof value.rateLimitPerMinute === "number" &&
    typeof value.policyVersion === "number"
  );
}

export function isEffectiveConfigByPlatform(value: unknown): value is EffectiveConfigByPlatform {
  return (
    isRecord(value) &&
    PLATFORM_IDS.every((platform) => {
      const config: unknown = value[platform];
      return isEffectivePlatformConfig(config) && config.platform === platform;
    })
  );
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.type) {
    case "config.get":
      return isPlatformId(value.platform);
    case "policy.refresh":
      return true;
    case "config.changed":
      return isEffectiveConfigByPlatform(value.configs);
    default:
      return false;
  }
}

export function isResponseFor<T extends RuntimeMessageType>(
  type: T,
  value: unknown,
): value is ResponseByType[T] {
  switch (type) {
    case "config.get":
      return isRecord(value) && isEffectivePlatformConfig(value.config);
    case "policy.refresh":
      return (
        isRecord(value) &&
        typeof value.ok === "boolean" &&
        (value.error === undefined || typeof value.error === "string")
      );
    default:
      return value === undefined;
  }
}

/**
 * A sender object is only absent when something other than the extension runtime invoked the
 * listener; the id check is defence in depth against a future onMessageExternal registration.
 */
function isTrustedSender(sender: unknown): sender is Browser.runtime.MessageSender {
  if (!isRecord(sender)) {
    return false;
  }
  return sender.id === undefined || sender.id === browser.runtime.id;
}

/** Sends a request to the background and resolves with its validated response. */
export async function sendRequest<T extends RuntimeMessageType>(
  message: MessageOf<T>,
): Promise<ResponseByType[T]> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (!isResponseFor(message.type, response)) {
    throw new Error(`Malformed response to ${message.type}`);
  }
  return response;
}

/** Registers a handler for one message type; returns the unsubscribe function. */
export function onRequest<T extends RuntimeMessageType>(
  type: T,
  handler: RequestHandler<T>,
): () => void {
  const listener = (
    message: unknown,
    sender: unknown,
    sendResponse: (response?: unknown) => void,
  ): true | undefined => {
    if (!isTrustedSender(sender) || !isRuntimeMessage(message) || message.type !== type) {
      return undefined;
    }
    // The async wrapper turns a synchronous throw into a rejection so it cannot escape the listener.
    (async () => handler(message as MessageOf<T>, sender))().then(
      (response) => sendResponse(response),
      (error: unknown) => {
        console.error(`Botdar handler for ${type} failed`, error);
        sendResponse(undefined);
      },
    );
    // Returning true keeps the channel open for the asynchronous sendResponse (Chrome and Firefox).
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

/** Delivers a broadcast to every open tab; tabs without a Botdar content script are skipped. */
export async function broadcastToTabs(message: ConfigChangedBroadcast): Promise<void> {
  const tabs: Browser.tabs.Tab[] = await browser.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) {
        return;
      }
      try {
        await browser.tabs.sendMessage(tab.id, message);
      } catch {
        // No receiver in this tab.
      }
    }),
  );
}
