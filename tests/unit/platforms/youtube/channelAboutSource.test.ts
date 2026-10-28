// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { RateLimitedError } from "@/src/core/ratelimit";
import type { AccountRef, PartialSignals, ResolveContext, SignalSource } from "@/src/core/types";
import {
  CHANNEL_ABOUT_SOURCE_ID,
  FALLBACK_CLIENT_VERSION,
  aboutAddressOf,
  createChannelAboutSource,
  pageClientVersion,
} from "@/src/platforms/youtube/sources/channelAbout";

const recordedBody = (name: string): string =>
  readFileSync(resolvePath(process.cwd(), "tests/fixtures/youtube/innertube", name), "utf8");

const ref = (handle: string): AccountRef => ({ platform: "youtube", handle });

const context = (): ResolveContext => ({
  signal: new AbortController().signal,
  config: {
    platform: "youtube",
    enabled: true,
    tiers: { t1: false, t2: true },
    rateLimitPerMinute: 10,
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
  return {
    source: createChannelAboutSource({
      fetch: fetch as unknown as typeof fetch,
      clientVersion: () => "2.20261101.00.00",
    }),
    fetch,
  };
}

const resolve = (source: SignalSource, handle = "jonas_reads12") => {
  if (source.resolve === undefined) throw new Error("active source without resolve");
  return source.resolve(ref(handle), context());
};

const requestOf = (fetch: ReturnType<typeof vi.fn>, call: number): [string, RequestInit] =>
  fetch.mock.calls[call] as [string, RequestInit];

describe("YouTube channel About source", () => {
  it("is an active Tier 2 source for YouTube", () => {
    const { source } = harness();
    expect(source).toMatchObject({
      id: CHANNEL_ABOUT_SOURCE_ID,
      platform: "youtube",
      tier: 2,
      kind: "active",
    });
  });

  it("resolves the About address, then browses it, without cookies and in English", async () => {
    const { source, fetch } = harness(
      jsonResponse(recordedBody("resolve-url.json")),
      jsonResponse(recordedBody("browse-about.json")),
    );
    const signals: PartialSignals | null = await resolve(source);
    expect(signals).toEqual({
      createdAt: Date.UTC(2013, 9, 15),
      postCount: 4,
      followers: 3,
      bio: "",
      displayName: "Wally",
    });
    const [resolveUrl, resolveInit] = requestOf(fetch, 0);
    expect(resolveUrl).toBe(
      "https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false",
    );
    expect(resolveInit).toMatchObject({ method: "POST", credentials: "omit" });
    expect(JSON.parse(String(resolveInit.body))).toEqual({
      context: { client: { clientName: "WEB", clientVersion: "2.20261101.00.00", hl: "en" } },
      url: "https://www.youtube.com/@jonas_reads12/about",
    });
    const [browseUrl, browseInit] = requestOf(fetch, 1);
    expect(browseUrl).toBe("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false");
    expect(JSON.parse(String(browseInit.body))).toMatchObject({
      browseId: "UCw7ictt1i8xu9166kl9l7ui",
      params: "EgVhYm91dLgBAJIDAPIGBgoCMgBKAA%3D%3D",
    });
  });

  it("caches a handle no channel answers to as an empty stub, and asks no further", async () => {
    const { source, fetch } = harness(jsonResponse("{}", 404));
    await expect(resolve(source, "nobody-here")).resolves.toEqual({});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hands a 429 to the limiter with its retry-after", async () => {
    const { source } = harness(jsonResponse("{}", 429, { "retry-after": "30" }));
    await expect(resolve(source)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("caches nothing when a request fails, a body is mangled or answers for another channel", async () => {
    const otherChannel: string = recordedBody("browse-about.json").replaceAll(
      "UCw7ictt1i8xu9166kl9l7ui",
      "UCaaaaaaaaaaaaaaaaaaaaaa",
    );
    for (const responses of [
      [new Error("offline")],
      [jsonResponse("{}", 500)],
      [jsonResponse("not json")],
      [jsonResponse(recordedBody("resolve-url.json")), jsonResponse("{}", 500)],
      [jsonResponse(recordedBody("resolve-url.json")), jsonResponse(otherChannel)],
    ]) {
      const { source } = harness(...responses);
      await expect(resolve(source)).resolves.toBeNull();
    }
  });

  it("writes the About address of a handle in any script", () => {
    expect(aboutAddressOf("ασσουρμπανιπάλ-ψ9χ")).toBe(
      `https://www.youtube.com/@${encodeURIComponent("ασσουρμπανιπάλ-ψ9χ")}/about`,
    );
  });
});

describe("the client version a lookup names", () => {
  it("keeps reading the page until it finds one, then keeps only what it read", async () => {
    const versions: Array<string | undefined> = [undefined, "2.20261101.00.00", "2.29990101.00.00"];
    const clientVersion = vi.fn((): string | undefined => versions.shift());
    const fetch = vi.fn(async () => jsonResponse("{}", 404));
    const source: SignalSource = createChannelAboutSource({
      fetch: fetch as unknown as typeof fetch,
      clientVersion,
    });
    for (let lookup = 0; lookup < 3; lookup += 1) await resolve(source);
    const sent: string[] = fetch.mock.calls.map(
      (call) =>
        JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).context.client
          .clientVersion,
    );
    // The first lookup ran before the page's ytcfg was readable and fell back; the fallback was not
    // kept, so the second read the page, and that version stuck.
    expect(sent).toEqual([FALLBACK_CLIENT_VERSION, "2.20261101.00.00", "2.20261101.00.00"]);
    expect(clientVersion).toHaveBeenCalledTimes(2);
  });
});

describe("pageClientVersion", () => {
  it("reads the version from the page's ytcfg script, and the source falls back without one", async () => {
    document.head.innerHTML = `<script>ytcfg.set({"INNERTUBE_API_KEY":"x","INNERTUBE_CLIENT_VERSION":"2.20261027.01.00","HL":"en"});</script>`;
    expect(pageClientVersion(document)).toBe("2.20261027.01.00");
    document.head.innerHTML = "";
    expect(pageClientVersion(document)).toBeUndefined();
    const fetch = vi.fn(async () => jsonResponse("{}", 404));
    const source: SignalSource = createChannelAboutSource({
      fetch: fetch as unknown as typeof fetch,
    });
    await resolve(source);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).context.client.clientVersion).toBe(
      FALLBACK_CLIENT_VERSION,
    );
  });
});
