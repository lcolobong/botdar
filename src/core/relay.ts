/**
 * The MAIN-world → isolated-world relay (ADR-0011). The MAIN-world interceptor posts intercepted
 * response bodies through `window.postMessage`; the isolated-world receiver accepts only messages
 * from this window and origin, with the exact envelope marker and version, and treats every body as
 * untrusted data. A hostile page script can satisfy these checks, so nothing privileged is ever
 * reachable from a relay message: bodies only feed parsers that run type guards and never throw.
 */

export const RELAY_MARKER = 1;
export const RELAY_VERSION = 1;

/** Measured as JSON text length; larger bodies are dropped before any parser sees them. */
export const MAX_RELAY_BODY_CHARS = 5 * 1024 * 1024;

export interface RelayEnvelope {
  __botdar: typeof RELAY_MARKER;
  v: typeof RELAY_VERSION;
  kind: string;
  op?: string;
  queryId?: string;
  /** The request's query string when the interceptor passes it on (untrusted, like the body). */
  query?: string;
  body: unknown;
}

export interface RelayPayload {
  op?: string;
  queryId?: string;
  query?: string;
  body: unknown;
}

export type RelayCallback = (envelope: RelayEnvelope) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

export function isRelayEnvelope(value: unknown): value is RelayEnvelope {
  return (
    isRecord(value) &&
    value.__botdar === RELAY_MARKER &&
    value.v === RELAY_VERSION &&
    typeof value.kind === "string" &&
    isOptionalString(value.op) &&
    isOptionalString(value.queryId) &&
    isOptionalString(value.query) &&
    "body" in value
  );
}

export function isRelayBodyWithinLimit(body: unknown): boolean {
  try {
    const serialized: string | undefined = JSON.stringify(body);
    return serialized !== undefined && serialized.length <= MAX_RELAY_BODY_CHARS;
  } catch {
    return false;
  }
}

/** Posts an envelope to the same window. Runs in the page's MAIN world, so it must never throw. */
export function postRelay(kind: string, payload: RelayPayload, target: Window = window): void {
  const envelope: RelayEnvelope = {
    __botdar: RELAY_MARKER,
    v: RELAY_VERSION,
    kind,
    ...(payload.op !== undefined ? { op: payload.op } : {}),
    ...(payload.queryId !== undefined ? { queryId: payload.queryId } : {}),
    ...(payload.query !== undefined ? { query: payload.query } : {}),
    body: payload.body,
  };
  try {
    target.postMessage(envelope, target.location.origin);
  } catch {
    // An unserializable body or a mismatched origin is the interceptor's loss, never the page's.
  }
}

/** Subscribes to envelopes of one kind that pass every guard; returns the unsubscribe function. */
export function onRelay(
  kind: string,
  callback: RelayCallback,
  target: Window = window,
): () => void {
  const listener = (event: MessageEvent<unknown>): void => {
    if (event.source !== target || event.origin !== target.location.origin) {
      return;
    }
    const envelope: unknown = event.data;
    if (!isRelayEnvelope(envelope) || envelope.kind !== kind) {
      return;
    }
    if (!isRelayBodyWithinLimit(envelope.body)) {
      return;
    }
    callback(envelope);
  };
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}
