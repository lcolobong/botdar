import { readFileSync } from "node:fs";

import { RateLimitedError } from "@/src/core/ratelimit";
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "@/src/core/types";
import {
  FIREBASE_USER_SOURCE_ID,
  createFirebaseUserSource,
  firebaseUserUrl,
} from "@/src/platforms/hackernews/sources/firebaseUser";

const recordedBody = (name: string): string =>
  readFileSync(new URL(`../../../fixtures/hackernews/firebase/${name}`, import.meta.url), "utf8");

const ref = (handle: string): AccountRef => ({ platform: "hackernews", handle });

const context = (signal: AbortSignal = new AbortController().signal): ResolveContext => ({
  signal,
  config: {
    platform: "hackernews",
    enabled: true,
    tiers: { t1: false, t2: true },
    rateLimitPerMinute: 30,
    policyVersion: 1,
  },
});

const jsonResponse = (body: string, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { "content-type": "application/json", ...headers } });

interface Harness {
  source: SignalSource;
  fetch: ReturnType<typeof vi.fn>;
}

function harness(...responses: Array<Response | Error>): Harness {
  const fetch = vi.fn(async (): Promise<Response> => {
    const next: Response | Error | undefined = responses.shift();
    if (next === undefined) throw new Error("no response queued");
    if (next instanceof Error) throw next;
    return next;
  });
  return { source: createFirebaseUserSource({ fetch: fetch as unknown as typeof fetch }), fetch };
}

const resolve = (source: SignalSource, handle: string) => {
  if (source.resolve === undefined) throw new Error("active source without resolve");
  return source.resolve(ref(handle), context());
};

describe("Firebase user source", () => {
  it("declares an active Tier 2 Hacker News source", () => {
    const { source } = harness();
    expect(source).toMatchObject({
      id: FIREBASE_USER_SOURCE_ID,
      platform: "hackernews",
      tier: 2,
      kind: "active",
    });
  });

  it("asks the public API for the exact, case-sensitive id, without credentials", async () => {
    const { source, fetch } = harness(jsonResponse(recordedBody("user.json")));
    const signals: PartialSignals | null = await resolve(source, "priya_draws71");
    expect(signals).toMatchObject({ karma: 595, postCount: 147 });
    expect(fetch).toHaveBeenCalledWith(
      "https://hacker-news.firebaseio.com/v0/user/priya_draws71.json",
      expect.objectContaining({ credentials: "omit" }),
    );
    expect(firebaseUserUrl("A b/c")).toBe(
      "https://hacker-news.firebaseio.com/v0/user/A%20b%2Fc.json",
    );
  });

  it("ignores a body for another id, which a different casing would be", async () => {
    const { source } = harness(jsonResponse(recordedBody("user.json")));
    await expect(resolve(source, "Priya_Draws71")).resolves.toBeNull();
  });

  it("caches an unknown id as an empty stub and leaves failures uncached", async () => {
    const { source } = harness(
      jsonResponse("null"),
      jsonResponse("{}", 500),
      jsonResponse("not json"),
      new Error("offline"),
    );
    await expect(resolve(source, "nobody")).resolves.toEqual({});
    await expect(resolve(source, "nobody")).resolves.toBeNull();
    await expect(resolve(source, "nobody")).resolves.toBeNull();
    await expect(resolve(source, "nobody")).resolves.toBeNull();
  });

  it("reports a 429 to the limiter with its retry-after", async () => {
    const { source } = harness(jsonResponse("", 429, { "retry-after": "30" }));
    const rejection: unknown = await resolve(source, "priya_draws71").catch((error) => error);
    expect(rejection).toBeInstanceOf(RateLimitedError);
    expect((rejection as RateLimitedError).retryAfterMs).toBe(30_000);
  });

  it("reads a retry-after given as an HTTP date too", async () => {
    const retryAt: string = new Date(Date.now() + 120_000).toUTCString();
    const { source } = harness(jsonResponse("", 429, { "retry-after": retryAt }));
    const rejection: unknown = await resolve(source, "priya_draws71").catch((error) => error);
    const retryAfterMs: number | undefined = (rejection as RateLimitedError).retryAfterMs;
    expect(retryAfterMs).toBeGreaterThan(100_000);
    expect(retryAfterMs).toBeLessThanOrEqual(120_000);
  });
});
