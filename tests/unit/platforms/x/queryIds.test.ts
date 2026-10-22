// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}

import { X_GRAPHQL_REQUEST_RELAY_KIND } from "@/src/platforms/x/graphqlRoutes";
import { FALLBACK_ABOUT_ACCOUNT_QUERY_ID, QueryIdRegistry } from "@/src/platforms/x/queryIds";

const OBSERVED_ID = "ObservedQueryId_0001";
const POLICY_ID = "PolicyQueryId_000002";
const OP = "AboutAccountQuery";

describe("QueryIdRegistry.resolve", () => {
  it("falls back to the baked id when nothing else is known", () => {
    expect(new QueryIdRegistry().resolve(OP)).toBe(FALLBACK_ABOUT_ACCOUNT_QUERY_ID);
    expect(new QueryIdRegistry().resolve("UnknownOperation")).toBeUndefined();
  });

  it("prefers an observed id over the policy, and the policy over the fallback", () => {
    const registry = new QueryIdRegistry();
    expect(registry.resolve(OP, POLICY_ID)).toBe(POLICY_ID);
    registry.observe(OP, OBSERVED_ID);
    expect(registry.resolve(OP, POLICY_ID)).toBe(OBSERVED_ID);
  });

  it("ignores malformed ids from traffic and policy", () => {
    const registry = new QueryIdRegistry();
    registry.observe(OP, "short");
    registry.observe(OP, "has spaces in it which fail");
    expect(registry.resolve(OP, "bad id")).toBe(FALLBACK_ABOUT_ACCOUNT_QUERY_ID);
  });

  it("skips a stale id and moves to the next source, until it is observed again", () => {
    const registry = new QueryIdRegistry();
    registry.observe(OP, OBSERVED_ID);
    registry.markStale(OP, OBSERVED_ID);
    expect(registry.resolve(OP, POLICY_ID)).toBe(POLICY_ID);
    registry.markStale(OP, POLICY_ID);
    expect(registry.resolve(OP, POLICY_ID)).toBe(FALLBACK_ABOUT_ACCOUNT_QUERY_ID);
    registry.markStale(OP, FALLBACK_ABOUT_ACCOUNT_QUERY_ID);
    expect(registry.resolve(OP, POLICY_ID)).toBeUndefined();
    registry.observe(OP, OBSERVED_ID);
    expect(registry.resolve(OP, POLICY_ID)).toBe(OBSERVED_ID);
  });

  it("records ids only for allowlisted operations", () => {
    const registry = new QueryIdRegistry();
    registry.observe("CreateTweet", OBSERVED_ID);
    expect(registry.resolve("CreateTweet")).toBeUndefined();
    registry.observe("HomeTimeline", OBSERVED_ID);
    expect(registry.resolve("HomeTimeline")).toBe(OBSERVED_ID);
  });

  it("keeps stale marks per operation", () => {
    const registry = new QueryIdRegistry();
    registry.observe("HomeTimeline", OBSERVED_ID);
    registry.markStale(OP, OBSERVED_ID);
    expect(registry.resolve("HomeTimeline")).toBe(OBSERVED_ID);
  });
});

describe("QueryIdRegistry.startObserving", () => {
  const relayRequest = (
    op: string,
    queryId?: string,
    kind = X_GRAPHQL_REQUEST_RELAY_KIND,
  ): void => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __botdar: 1, v: 1, kind, op, ...(queryId ? { queryId } : {}), body: null },
        origin: location.origin,
        source: window,
      }),
    );
  };

  it("learns ids from relayed requests and stops on unsubscribe", () => {
    const registry = new QueryIdRegistry();
    const stop: () => void = registry.startObserving();
    relayRequest(OP, OBSERVED_ID);
    expect(registry.resolve(OP)).toBe(OBSERVED_ID);

    relayRequest(OP, POLICY_ID, "x.graphql");
    relayRequest(OP);
    expect(registry.resolve(OP)).toBe(OBSERVED_ID);

    stop();
    relayRequest(OP, POLICY_ID);
    expect(registry.resolve(OP)).toBe(OBSERVED_ID);
  });
});
