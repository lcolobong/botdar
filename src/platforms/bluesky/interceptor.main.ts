/**
 * MAIN-world fetch interceptor for bsky.app (ADR-0011). Runs with the page's own privileges, so it
 * does the least possible: wraps `window.fetch`, hands the original response straight back, and
 * reads a clone of the allowlisted XRPC responses asynchronously inside try/catch. Parsing happens
 * in the isolated world; this bundle only posts the relay envelope. The request URL is read inside
 * the same try/catch, so a Proxy from the page that throws on access never surfaces from `fetch`.
 *
 * The wrapper carries the native `name` and `length` so a page that fingerprints extensions through
 * `fetch.name`/`fetch.length` sees nothing unusual. `fetch.toString()` still reveals the wrapper;
 * that residual risk is documented in docs/architecture.md (threat model) and accepted (ADR-0011).
 */
import { MAX_RELAY_BODY_CHARS, postRelay } from "../../core/relay";
import {
  AUTHOR_FEED_OPERATION,
  BLUESKY_RELAY_KIND,
  MAX_RELAYED_QUERY_LENGTH,
  xrpcOperationOf,
} from "./xrpc";

type FetchFn = typeof globalThis.fetch;

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/** The author feed's query string (its filter decides whether its posts count), capped. */
function authorFeedQueryOf(operation: string, requestUrl: string): string | undefined {
  if (operation !== AUTHOR_FEED_OPERATION) {
    return undefined;
  }
  const query: string = new URL(requestUrl, "https://bsky.app").search;
  return query.length <= MAX_RELAYED_QUERY_LENGTH ? query : undefined;
}

async function relayResponseBody(
  operation: string,
  query: string | undefined,
  response: Response,
  target: Window,
): Promise<void> {
  try {
    // Read as text first so an oversized body is dropped before JSON.parse allocates for it.
    const text: string = await response.clone().text();
    if (text.length > MAX_RELAY_BODY_CHARS) {
      return;
    }
    const body: unknown = JSON.parse(text);
    postRelay(
      BLUESKY_RELAY_KIND,
      { op: operation, ...(query === undefined ? {} : { query }), body },
      target,
    );
  } catch {
    // A non-JSON or already-consumed body is the interceptor's loss, never the page's.
  }
}

/** Makes the wrapper report the wrapped native's `name` and `length`. */
function disguiseAsNative(wrapper: FetchFn, name: string, length: number): void {
  Object.defineProperty(wrapper, "name", { value: name, configurable: true });
  Object.defineProperty(wrapper, "length", { value: length, configurable: true });
}

const patchedWindows = new WeakSet<Window>();

/** Replaces `target.fetch` with a wrapper that relays allowlisted XRPC bodies; idempotent per window. */
export function installXrpcInterceptor(target: Window = window): void {
  if (patchedWindows.has(target)) {
    return;
  }
  patchedWindows.add(target);
  const original: FetchFn = target.fetch;
  const patched: FetchFn = async function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response: Response = await original.call(this ?? target, input, init);
    try {
      const requestUrl: string = requestUrlOf(input);
      const operation: string | undefined = xrpcOperationOf(requestUrl, target.location.href);
      if (operation !== undefined) {
        void relayResponseBody(
          operation,
          authorFeedQueryOf(operation, requestUrl),
          response,
          target,
        );
      }
    } catch {
      // Matching must never change what the page receives, even when reading the input throws.
    }
    return response;
  };
  disguiseAsNative(patched, "fetch", 1);
  target.fetch = patched;
}
