// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}

import type { RelayEnvelope } from "@/src/core/relay";
import {
  MAX_RELAY_BODY_CHARS,
  isRelayBodyWithinLimit,
  isRelayEnvelope,
  onRelay,
  postRelay,
} from "@/src/core/relay";

const dispatchForged = (data: unknown, init: Partial<MessageEventInit> = {}): void => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: location.origin,
      source: window,
      ...init,
    }),
  );
};

const validEnvelope = (): RelayEnvelope => ({
  __botdar: 1,
  v: 1,
  kind: "x.graphql",
  op: "HomeTimeline",
  queryId: "abc123",
  body: { data: {} },
});

describe("relay envelope guards", () => {
  it("accepts the exact envelope shape", () => {
    expect(isRelayEnvelope(validEnvelope())).toBe(true);
    expect(isRelayEnvelope({ __botdar: 1, v: 1, kind: "k", body: null })).toBe(true);
  });

  it("rejects a wrong marker, version, kind or optional field type", () => {
    expect(isRelayEnvelope({ ...validEnvelope(), __botdar: 2 })).toBe(false);
    expect(isRelayEnvelope({ ...validEnvelope(), __botdar: "1" })).toBe(false);
    expect(isRelayEnvelope({ ...validEnvelope(), v: 2 })).toBe(false);
    expect(isRelayEnvelope({ ...validEnvelope(), kind: 7 })).toBe(false);
    expect(isRelayEnvelope({ ...validEnvelope(), op: 7 })).toBe(false);
    expect(isRelayEnvelope({ ...validEnvelope(), queryId: {} })).toBe(false);
    expect(isRelayEnvelope({ __botdar: 1, v: 1, kind: "k" })).toBe(false);
    expect(isRelayEnvelope(null)).toBe(false);
    expect(isRelayEnvelope("x")).toBe(false);
  });

  it("measures the body as JSON text", () => {
    expect(isRelayBodyWithinLimit({ a: 1 })).toBe(true);
    expect(isRelayBodyWithinLimit("x".repeat(MAX_RELAY_BODY_CHARS - 2))).toBe(true);
    expect(isRelayBodyWithinLimit("x".repeat(MAX_RELAY_BODY_CHARS))).toBe(false);
    expect(isRelayBodyWithinLimit(undefined)).toBe(false);
    expect(isRelayBodyWithinLimit({ big: 1n })).toBe(false);
  });
});

describe("postRelay and onRelay", () => {
  let unsubscribe: () => void = () => undefined;

  afterEach(() => {
    unsubscribe();
  });

  // happy-dom's own postMessage reports its internal frame window as `event.source`, which the
  // receiver rightly rejects, so posting is asserted against a spied target window instead.
  const spiedTarget = (): { target: Window; postMessage: ReturnType<typeof vi.fn> } => {
    const postMessage = vi.fn();
    const target = { postMessage, location: { origin: location.origin } } as unknown as Window;
    return { target, postMessage };
  };

  it("posts the envelope to the window's own origin", () => {
    const { target, postMessage } = spiedTarget();

    postRelay("x.graphql", { op: "HomeTimeline", queryId: "q1", body: { ok: true } }, target);

    expect(postMessage).toHaveBeenCalledWith(
      {
        __botdar: 1,
        v: 1,
        kind: "x.graphql",
        op: "HomeTimeline",
        queryId: "q1",
        body: { ok: true },
      },
      "https://x.com",
    );
  });

  it("omits absent optional fields from the envelope", () => {
    const { target, postMessage } = spiedTarget();

    postRelay("bluesky.xrpc", { body: [] }, target);

    expect(postMessage).toHaveBeenCalledWith(
      { __botdar: 1, v: 1, kind: "bluesky.xrpc", body: [] },
      "https://x.com",
    );
  });

  it("delivers a same-window, same-origin envelope of the subscribed kind", () => {
    const callback = vi.fn();
    unsubscribe = onRelay("x.graphql", callback);

    dispatchForged(validEnvelope());

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(validEnvelope());
  });

  it("ignores envelopes of another kind", () => {
    const callback = vi.fn();
    unsubscribe = onRelay("x.graphql", callback);

    dispatchForged({ ...validEnvelope(), kind: "bluesky.xrpc" });

    expect(callback).not.toHaveBeenCalled();
  });

  it("drops messages whose source is not this window", () => {
    const callback = vi.fn();
    unsubscribe = onRelay("x.graphql", callback);

    dispatchForged(validEnvelope(), { source: null });

    expect(callback).not.toHaveBeenCalled();
  });

  it("drops messages from another origin", () => {
    const callback = vi.fn();
    unsubscribe = onRelay("x.graphql", callback);

    dispatchForged(validEnvelope(), { origin: "https://evil.example" });

    expect(callback).not.toHaveBeenCalled();
  });

  it("drops messages without the marker or with a wrong version", () => {
    const callback = vi.fn();
    unsubscribe = onRelay("x.graphql", callback);

    dispatchForged({ ...validEnvelope(), __botdar: undefined });
    dispatchForged({ ...validEnvelope(), v: 0 });
    dispatchForged({ kind: "x.graphql", body: {} });

    expect(callback).not.toHaveBeenCalled();
  });

  it("drops bodies over the size cap", () => {
    const callback = vi.fn();
    unsubscribe = onRelay("x.graphql", callback);

    dispatchForged({ ...validEnvelope(), body: "x".repeat(MAX_RELAY_BODY_CHARS) });

    expect(callback).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", () => {
    const callback = vi.fn();
    unsubscribe = onRelay("x.graphql", callback);
    unsubscribe();

    dispatchForged(validEnvelope());

    expect(callback).not.toHaveBeenCalled();
  });

  it("never throws from postRelay when the body cannot be serialized", () => {
    expect(() => postRelay("x.graphql", { body: { big: 1n } })).not.toThrow();
  });
});
