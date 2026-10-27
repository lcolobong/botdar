/**
 * MAIN-world interceptor for X (docs/architecture.md, "Relay envelope"). Patches `fetch` and
 * `XMLHttpRequest` so the page's own GraphQL responses can be relayed to the isolated world. It
 * does no parsing beyond JSON.parse, always hands the page its original response, and reads a
 * clone asynchronously inside try/catch so a relay failure can never surface in the page. The
 * request `input`/URL is also read inside try/catch: a Proxy from the page that throws on access
 * must not turn into an exception thrown by the patched `fetch` or `send`.
 *
 * The wrappers carry the native `name` and `length` so a page that fingerprints extensions through
 * `fetch.name`/`fetch.length` sees nothing unusual. `fetch.toString()` still reveals the wrapper;
 * that residual risk is documented in docs/architecture.md (threat model) and accepted (ADR-0011).
 */
import { MAX_RELAY_BODY_CHARS, postRelay } from "@/src/core/relay";
import type { GraphqlOperation } from "./graphqlRoutes";
import {
  X_GRAPHQL_OPERATIONS,
  X_GRAPHQL_RELAY_KIND,
  X_GRAPHQL_REQUEST_RELAY_KIND,
  matchGraphqlOperation,
} from "./graphqlRoutes";

export type PageWindow = Window & typeof globalThis;

type XhrBody = Document | XMLHttpRequestBodyInit | null | undefined;

const requestUrlByXhr = new WeakMap<XMLHttpRequest, string>();

function requestUrlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** Makes a wrapper report the wrapped native's `name` and `length`. */
function disguiseAsNative(
  wrapper: (...args: never[]) => unknown,
  name: string,
  length: number,
): void {
  Object.defineProperty(wrapper, "name", { value: name, configurable: true });
  Object.defineProperty(wrapper, "length", { value: length, configurable: true });
}

/** Relays a response body (JSON text or an already parsed object); never throws. */
function relay(target: PageWindow, operation: GraphqlOperation, body: unknown): void {
  try {
    if (typeof body === "string" && body.length > MAX_RELAY_BODY_CHARS) {
      return;
    }
    const parsed: unknown = typeof body === "string" ? JSON.parse(body) : body;
    postRelay(X_GRAPHQL_RELAY_KIND, { ...operation, body: parsed }, target);
  } catch {
    // A body that is not JSON is the interceptor's loss, never the page's.
  }
}

/**
 * Announces every GraphQL request; returns the operation only when its response is allowlisted.
 * `readUrl` runs inside the try/catch because it touches page-owned values; never throws.
 */
function noteRequest(target: PageWindow, readUrl: () => string): GraphqlOperation | undefined {
  try {
    const operation: GraphqlOperation | undefined = matchGraphqlOperation(
      readUrl(),
      target.location.href,
    );
    if (operation === undefined) {
      return undefined;
    }
    postRelay(
      X_GRAPHQL_REQUEST_RELAY_KIND,
      { op: operation.op, queryId: operation.queryId, body: null },
      target,
    );
    return X_GRAPHQL_OPERATIONS.has(operation.op) ? operation : undefined;
  } catch {
    return undefined;
  }
}

function onXhrLoadEnd(target: PageWindow, operation: GraphqlOperation, xhr: XMLHttpRequest): void {
  const textual: boolean = xhr.responseType === "" || xhr.responseType === "text";
  if (xhr.status >= 200 && xhr.status < 300 && (textual || xhr.responseType === "json")) {
    relay(target, operation, textual ? xhr.responseText : xhr.response);
  }
}

export function installInterceptor(target: PageWindow = window): void {
  const originalFetch: typeof target.fetch = target.fetch;
  target.fetch = function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const result: Promise<Response> = originalFetch.call(this, input, init);
    const operation: GraphqlOperation | undefined = noteRequest(target, () => requestUrlOf(input));
    if (operation !== undefined) {
      result
        .then((response) => (response.ok ? response.clone().text() : undefined))
        .then((text) => text !== undefined && relay(target, operation, text))
        .catch(() => undefined);
    }
    return result;
  };
  disguiseAsNative(target.fetch, "fetch", 1);

  const xhrPrototype: XMLHttpRequest = target.XMLHttpRequest.prototype;
  const originalOpen: XMLHttpRequest["open"] = xhrPrototype.open;
  const originalSend: XMLHttpRequest["send"] = xhrPrototype.send;
  xhrPrototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    isAsync: boolean = true,
    username?: string | null,
    password?: string | null,
  ): void {
    try {
      requestUrlByXhr.set(this, String(url));
    } catch {
      // A URL whose toString throws is left to the native open to reject.
    }
    originalOpen.call(this, method, url, isAsync, username, password);
  };
  disguiseAsNative(xhrPrototype.open, "open", 2);
  xhrPrototype.send = function patchedSend(this: XMLHttpRequest, body?: XhrBody): void {
    const operation: GraphqlOperation | undefined = noteRequest(
      target,
      () => requestUrlByXhr.get(this) ?? "",
    );
    if (operation !== undefined) {
      this.addEventListener("loadend", () => onXhrLoadEnd(target, operation, this), { once: true });
    }
    originalSend.call(this, body);
  };
  disguiseAsNative(xhrPrototype.send, "send", 1);
}
