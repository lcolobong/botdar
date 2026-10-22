import { readFileSync } from "node:fs";

import { RateLimitedError } from "@/src/core/ratelimit";
import type { AccountRef, PartialSignals, ResolveContext } from "@/src/core/types";
import type { AboutJsonSource } from "@/src/platforms/reddit/sources/aboutJson";
import {
  ABOUT_JSON_SOURCE_ID,
  LOGIN_REQUIRED_PAUSE_MS,
  aboutJsonPath,
  createAboutJsonSource,
} from "@/src/platforms/reddit/sources/aboutJson";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../fixtures/reddit/about/${name}`, import.meta.url), "utf8");

const ref = (handle: string): AccountRef => ({ platform: "reddit", handle });

const context = (signal: AbortSignal = new AbortController().signal): ResolveContext => ({
  signal,
  config: {
    platform: "reddit",
    enabled: true,
    tiers: { t1: false, t2: true },
    rateLimitPerMinute: 30,
    policyVersion: 1,
  },
});

const jsonResponse = (body: string, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { "content-type": "application/json", ...headers } });

interface Harness {
  source: AboutJsonSource;
  fetch: ReturnType<typeof vi.fn>;
  clock: { now: number };
}

function harness(...responses: Array<Response | Error>): Harness {
  const clock = { now: 1_700_000_000_000 };
  const fetch = vi.fn(async (): Promise<Response> => {
    const next: Response | Error | undefined = responses.shift();
    if (next === undefined) throw new Error("no response queued");
    if (next instanceof Error) throw next;
    return next;
  });
  const source: AboutJsonSource = createAboutJsonSource({
    fetch: fetch as unknown as typeof fetch,
    now: () => clock.now,
  });
  return { source, fetch, clock };
}

const resolve = (source: AboutJsonSource, handle: string, signal?: AbortSignal) => {
  if (source.resolve === undefined) throw new Error("active source without resolve");
  return source.resolve(ref(handle), context(signal));
};

describe("about.json source", () => {
  it("declares an active Tier 2 Reddit source", () => {
    const { source } = harness();
    expect(source).toMatchObject({
      id: ABOUT_JSON_SOURCE_ID,
      platform: "reddit",
      tier: 2,
      kind: "active",
    });
    expect(source.start).toBeUndefined();
  });

  it("builds the same-origin path with raw_json", () => {
    expect(aboutJsonPath("quiet_lantern_4821")).toBe(
      "/user/quiet_lantern_4821/about.json?raw_json=1",
    );
    expect(aboutJsonPath("a/b")).toBe("/user/a%2Fb/about.json?raw_json=1");
  });

  it("fetches with cookies, a JSON accept header and the pipeline's abort signal", async () => {
    const { source, fetch } = harness(jsonResponse(fixture("normal.json")));
    const controller = new AbortController();

    const signals: PartialSignals | null = await resolve(
      source,
      "quiet_lantern_4821",
      controller.signal,
    );

    expect(fetch).toHaveBeenCalledWith("/user/quiet_lantern_4821/about.json?raw_json=1", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    expect(signals).toMatchObject({ createdAt: 1573498800000, linkKarma: 1840 });
  });

  it("returns null when the body describes a different account", async () => {
    const { source } = harness(jsonResponse(fixture("normal.json")));
    expect(await resolve(source, "someone_else")).toBeNull();
  });

  it("returns an empty stub for a suspended account", async () => {
    const { source } = harness(jsonResponse(fixture("suspended.json")));
    expect(await resolve(source, "gone_account_77")).toEqual({});
  });

  it("throws RateLimitedError on 429 with the retry-after header in milliseconds", async () => {
    const { source } = harness(jsonResponse("", 429, { "retry-after": "30" }));
    const failure: Promise<PartialSignals | null> = resolve(source, "quiet_lantern_4821");
    await expect(failure).rejects.toBeInstanceOf(RateLimitedError);
    await expect(resolve(harness(jsonResponse("", 429)).source, "x")).rejects.toMatchObject({
      retryAfterMs: undefined,
    });
    const { source: withHeader } = harness(jsonResponse("", 429, { "retry-after": "30" }));
    await expect(resolve(withHeader, "x")).rejects.toMatchObject({ retryAfterMs: 30_000 });
  });

  it.each([401, 403])("pauses lookups after a %i until the pause elapses", async (status) => {
    const { source, fetch, clock } = harness(
      jsonResponse("", status),
      jsonResponse(fixture("normal.json")),
    );

    expect(await resolve(source, "quiet_lantern_4821")).toBeNull();
    expect(source.loginRequired()).toBe(true);
    expect(await resolve(source, "quiet_lantern_4821")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    clock.now += LOGIN_REQUIRED_PAUSE_MS;
    expect(source.loginRequired()).toBe(false);
    expect(await resolve(source, "quiet_lantern_4821")).toMatchObject({ linkKarma: 1840 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats an HTML login page as logged out, by content type or by body", async () => {
    const typed: Harness = harness(
      new Response(fixture("redirect.html"), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    expect(await resolve(typed.source, "quiet_lantern_4821")).toBeNull();
    expect(typed.source.loginRequired()).toBe(true);

    const untyped: Harness = harness(jsonResponse(fixture("redirect.html")));
    expect(await resolve(untyped.source, "quiet_lantern_4821")).toBeNull();
    expect(untyped.source.loginRequired()).toBe(true);
  });

  it("returns null without pausing for a missing user or a server error", async () => {
    for (const status of [404, 500]) {
      const { source } = harness(jsonResponse("{}", status));
      expect(await resolve(source, "nobody")).toBeNull();
      expect(source.loginRequired()).toBe(false);
    }
  });

  it("returns null when the fetch itself fails or is aborted", async () => {
    const { source } = harness(new DOMException("aborted", "AbortError"));
    expect(await resolve(source, "quiet_lantern_4821")).toBeNull();
    expect(source.loginRequired()).toBe(false);
  });

  it("returns null for an oversized body and for a JSON body that is not an account", async () => {
    const huge: Harness = harness(jsonResponse(`{"pad":"${"x".repeat(1024 * 1024)}"}`));
    expect(await resolve(huge.source, "quiet_lantern_4821")).toBeNull();
    const wrongKind: Harness = harness(jsonResponse('{"kind":"t3","data":{}}'));
    expect(await resolve(wrongKind.source, "quiet_lantern_4821")).toBeNull();
    expect(wrongKind.source.loginRequired()).toBe(false);
  });

  it("returns an empty partial for a mangled account body", async () => {
    const { source } = harness(jsonResponse(fixture("mangled.json")));
    expect(await resolve(source, "odd_shape_01")).toEqual({});
  });
});
