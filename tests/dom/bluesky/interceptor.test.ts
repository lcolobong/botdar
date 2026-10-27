// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://bsky.app/"}

import { MAX_RELAY_BODY_CHARS } from "@/src/core/relay";
import { installXrpcInterceptor } from "@/src/platforms/bluesky/interceptor.main";

interface FakeWindow {
  target: Window;
  fetch: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const fakeWindow = (response: Response | (() => Response)): FakeWindow => {
  const fetch = vi.fn(async () => (typeof response === "function" ? response() : response));
  const postMessage = vi.fn();
  const target = {
    fetch,
    postMessage,
    location: { href: "https://bsky.app/", origin: "https://bsky.app" },
  } as unknown as Window;
  return { target, fetch, postMessage };
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("installXrpcInterceptor", () => {
  it("returns the page's own response untouched and relays an allowlisted body", async () => {
    const response: Response = jsonResponse({ feed: [] });
    const { target, fetch, postMessage } = fakeWindow(response);
    installXrpcInterceptor(target);

    const received: Response = await target.fetch(
      "https://api.bsky.app/xrpc/app.bsky.feed.getTimeline?limit=30",
      { headers: { authorization: "Bearer x" } },
    );
    await flush();

    expect(received).toBe(response);
    expect(received.bodyUsed).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.bsky.app/xrpc/app.bsky.feed.getTimeline?limit=30",
      { headers: { authorization: "Bearer x" } },
    );
    expect(postMessage).toHaveBeenCalledWith(
      { __botdar: 1, v: 1, kind: "bsky.xrpc", op: "app.bsky.feed.getTimeline", body: { feed: [] } },
      "https://bsky.app",
    );
  });

  it("relays an author feed's query string with its body, and no other operation's", async () => {
    const { target, postMessage } = fakeWindow(() => jsonResponse({ feed: [] }));
    installXrpcInterceptor(target);

    const query = "?actor=a.example.com&filter=posts_and_author_threads&limit=30";
    await target.fetch(`https://api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed${query}`);
    await target.fetch(`https://api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?${"x".repeat(3000)}`);
    await flush();

    expect(postMessage.mock.calls.map((call) => call[0].query)).toEqual([query, undefined]);
  });

  it("reads the URL from Request and URL inputs", async () => {
    const { target, postMessage } = fakeWindow(() => jsonResponse({ profiles: [] }));
    installXrpcInterceptor(target);

    await target.fetch(new Request("https://api.bsky.app/xrpc/app.bsky.actor.getProfiles"));
    await target.fetch(new URL("https://api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=a"));
    await flush();

    expect(postMessage.mock.calls.map((call) => call[0].op)).toEqual([
      "app.bsky.actor.getProfiles",
      "app.bsky.actor.getProfile",
    ]);
  });

  it("leaves other requests alone", async () => {
    const { target, postMessage } = fakeWindow(() => jsonResponse({ secret: true }));
    installXrpcInterceptor(target);

    await target.fetch("https://api.bsky.app/xrpc/com.atproto.server.getSession");
    await target.fetch("https://bsky.app/static/app.js");
    await flush();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("drops a body that is not JSON without touching the page's response", async () => {
    const response = new Response("<html>", { status: 502 });
    const { target, postMessage } = fakeWindow(response);
    installXrpcInterceptor(target);

    const received: Response = await target.fetch("/xrpc/app.bsky.feed.getFeed");
    await flush();

    expect(received).toBe(response);
    expect(await received.text()).toBe("<html>");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("drops a body over the relay cap", async () => {
    const oversized = new Response(JSON.stringify({ feed: "x".repeat(MAX_RELAY_BODY_CHARS) }), {
      headers: { "content-type": "application/json" },
    });
    const { target, postMessage } = fakeWindow(oversized);
    installXrpcInterceptor(target);

    const received: Response = await target.fetch("/xrpc/app.bsky.feed.getTimeline");
    await flush();

    expect(received).toBe(oversized);
    expect(received.bodyUsed).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("passes a Proxy input whose url getter throws straight through without throwing itself", async () => {
    const response: Response = jsonResponse({ feed: [] });
    const { target, fetch, postMessage } = fakeWindow(response);
    installXrpcInterceptor(target);
    const hostile: Request = new Proxy(
      new Request("https://api.bsky.app/xrpc/app.bsky.feed.getTimeline"),
      {
        get: (request, property) => {
          if (property === "url") throw new Error("page trap");
          return Reflect.get(request, property);
        },
      },
    );

    await expect(target.fetch(hostile)).resolves.toBe(response);
    await flush();

    expect(fetch).toHaveBeenCalledWith(hostile, undefined);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("reports the native name and length on the wrapper", () => {
    const { target } = fakeWindow(() => jsonResponse({}));
    installXrpcInterceptor(target);
    expect(target.fetch.name).toBe("fetch");
    expect(target.fetch).toHaveLength(1);
  });

  it("propagates a network failure exactly as the original fetch would", async () => {
    const failure = new TypeError("Failed to fetch");
    const fetch = vi.fn(async () => {
      throw failure;
    });
    const target = {
      fetch,
      postMessage: vi.fn(),
      location: { href: "https://bsky.app/" },
    } as unknown as Window;
    installXrpcInterceptor(target);

    await expect(target.fetch("/xrpc/app.bsky.feed.getTimeline")).rejects.toBe(failure);
  });

  it("patches a window only once", async () => {
    const { target, fetch } = fakeWindow(() => jsonResponse({}));
    installXrpcInterceptor(target);
    const patched: typeof target.fetch = target.fetch;

    installXrpcInterceptor(target);
    await target.fetch("/xrpc/app.bsky.feed.getTimeline");

    expect(target.fetch).toBe(patched);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
