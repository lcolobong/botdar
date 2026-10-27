import {
  X_GRAPHQL_RELAY_KIND,
  X_GRAPHQL_REQUEST_RELAY_KIND,
  matchGraphqlOperation,
} from "@/src/platforms/x/graphqlRoutes";
import type { PageWindow } from "@/src/platforms/x/interceptor.main";
import { installInterceptor } from "@/src/platforms/x/interceptor.main";

const ORIGIN = "https://x.com";
const PAGE = `${ORIGIN}/home`;
const QUERY_ID = "AbCdEf123456789_-xyz";
const timelineUrl = `${ORIGIN}/i/api/graphql/${QUERY_ID}/HomeTimeline?variables=%7B%7D`;

type Listener = (event: Event) => void;

/** The subset of XMLHttpRequest the interceptor touches, with a scriptable response. */
class FakeXhr {
  static nextResponse: { status: number; responseType: XMLHttpRequestResponseType; body: string } =
    { status: 200, responseType: "", body: "{}" };
  static opened: string[] = [];
  static sent: unknown[] = [];

  status = 0;
  responseType: XMLHttpRequestResponseType = "";
  responseText = "";
  response: unknown = null;
  private readonly listeners = new Map<string, Listener[]>();

  open(method: string, url: string | URL): void {
    FakeXhr.opened.push(`${method} ${String(url)}`);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(body?: unknown): void {
    FakeXhr.sent.push(body ?? null);
    const next = FakeXhr.nextResponse;
    this.status = next.status;
    this.responseType = next.responseType;
    this.responseText = next.body;
    this.response = next.responseType === "json" ? JSON.parse(next.body) : next.body;
    for (const listener of this.listeners.get("loadend") ?? []) {
      listener(new Event("loadend"));
    }
  }
}

interface Harness {
  target: PageWindow;
  postMessage: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
}

function makeHarness(response: Response | Error = new Response("{}")): Harness {
  const postMessage = vi.fn();
  const fetch = vi.fn((): Promise<Response> =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  const target = {
    postMessage,
    fetch,
    location: { origin: ORIGIN, href: PAGE },
    XMLHttpRequest: FakeXhr,
  } as unknown as PageWindow;
  FakeXhr.opened = [];
  FakeXhr.sent = [];
  installInterceptor(target);
  return { target, postMessage, fetch };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const envelope = (kind: string, op: string, body: unknown) => ({
  __botdar: 1,
  v: 1,
  kind,
  op,
  queryId: QUERY_ID,
  body,
});

describe("matchGraphqlOperation", () => {
  it("keeps the request query for the profile's posts and replies tabs only, capped", () => {
    const query = "?variables=%7B%22userId%22%3A%2212%22%7D";
    expect(matchGraphqlOperation(`/i/api/graphql/${QUERY_ID}/UserTweets${query}`, PAGE)).toEqual({
      op: "UserTweets",
      queryId: QUERY_ID,
      query,
    });
    expect(
      matchGraphqlOperation(`/i/api/graphql/${QUERY_ID}/UserTweetsAndReplies${query}`, PAGE),
    ).toEqual({ op: "UserTweetsAndReplies", queryId: QUERY_ID, query });
    expect(matchGraphqlOperation(`/i/api/graphql/${QUERY_ID}/TweetDetail${query}`, PAGE)).toEqual({
      op: "TweetDetail",
      queryId: QUERY_ID,
    });
    const huge = `?variables=${"x".repeat(5000)}`;
    expect(matchGraphqlOperation(`/i/api/graphql/${QUERY_ID}/UserTweets${huge}`, PAGE)).toEqual({
      op: "UserTweets",
      queryId: QUERY_ID,
    });
  });

  it("reads the query id and operation from an X GraphQL URL, absolute or relative", () => {
    expect(matchGraphqlOperation(timelineUrl, PAGE)).toEqual({
      op: "HomeTimeline",
      queryId: QUERY_ID,
    });
    expect(matchGraphqlOperation(`/i/api/graphql/${QUERY_ID}/TweetDetail`, `${ORIGIN}/a`)).toEqual({
      op: "TweetDetail",
      queryId: QUERY_ID,
    });
    expect(
      matchGraphqlOperation(`https://api.twitter.com/i/api/graphql/${QUERY_ID}/Followers`, PAGE),
    ).toEqual({ op: "Followers", queryId: QUERY_ID });
  });

  it("ignores other hosts, other paths and malformed ids", () => {
    expect(
      matchGraphqlOperation(`https://evil.example/i/api/graphql/${QUERY_ID}/HomeTimeline`, PAGE),
    ).toBe(undefined);
    expect(
      matchGraphqlOperation(`${ORIGIN}/i/api/1.1/friendships/create.json`, PAGE),
    ).toBeUndefined();
    expect(
      matchGraphqlOperation(`${ORIGIN}/i/api/graphql/short/HomeTimeline`, PAGE),
    ).toBeUndefined();
    expect(matchGraphqlOperation("not a url", "also not")).toBeUndefined();
  });
});

describe("installInterceptor: fetch", () => {
  it("returns the page's own response and relays the request and the parsed body", async () => {
    const original = new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    const { target, postMessage, fetch } = makeHarness(original);

    const returned: Response = await target.fetch(timelineUrl, { method: "GET" });
    await flush();

    expect(returned).toBe(original);
    expect(await returned.text()).toBe('{"data":{"ok":true}}');
    expect(fetch).toHaveBeenCalledWith(timelineUrl, { method: "GET" });
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      envelope(X_GRAPHQL_REQUEST_RELAY_KIND, "HomeTimeline", null),
      ORIGIN,
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      envelope(X_GRAPHQL_RELAY_KIND, "HomeTimeline", { data: { ok: true } }),
      ORIGIN,
    );
  });

  it("accepts Request and URL inputs", async () => {
    const { target, postMessage } = makeHarness();
    await target.fetch(new URL(timelineUrl));
    await target.fetch(new Request(timelineUrl));
    await flush();
    expect(postMessage).toHaveBeenCalledTimes(4);
  });

  it("announces a request outside the allowlist without relaying its body", async () => {
    const { target, postMessage } = makeHarness();
    await target.fetch(`${ORIGIN}/i/api/graphql/${QUERY_ID}/CreateTweet`, { method: "POST" });
    await flush();
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      envelope(X_GRAPHQL_REQUEST_RELAY_KIND, "CreateTweet", null),
      ORIGIN,
    );
  });

  it("leaves non-GraphQL requests alone", async () => {
    const { target, postMessage } = makeHarness();
    await target.fetch(`${ORIGIN}/i/api/1.1/jot/client_event.json`);
    await flush();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("drops a failed response, a non-JSON body and a rejected fetch without throwing", async () => {
    const failing = makeHarness(new Response("{}", { status: 500 }));
    await failing.target.fetch(timelineUrl);
    const garbage = makeHarness(new Response("<html>", { status: 200 }));
    await garbage.target.fetch(timelineUrl);
    const rejected = makeHarness(new Error("offline"));
    await expect(rejected.target.fetch(timelineUrl)).rejects.toThrow("offline");
    await flush();
    for (const { postMessage } of [failing, garbage, rejected]) {
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage.mock.calls[0]?.[0]).toMatchObject({ kind: X_GRAPHQL_REQUEST_RELAY_KIND });
    }
  });

  it("passes a Proxy input whose url getter throws straight through without throwing itself", async () => {
    const original = new Response("{}");
    const { target, postMessage, fetch } = makeHarness(original);
    const hostile: Request = new Proxy(new Request(timelineUrl), {
      get: (request, property) => {
        if (property === "url") throw new Error("page trap");
        return Reflect.get(request, property);
      },
    });

    await expect(target.fetch(hostile)).resolves.toBe(original);
    await flush();

    expect(fetch).toHaveBeenCalledWith(hostile, undefined);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("reports the native name and length on the wrapper", () => {
    const { target } = makeHarness();
    expect(target.fetch.name).toBe("fetch");
    expect(target.fetch).toHaveLength(1);
  });
});

describe("installInterceptor: XMLHttpRequest", () => {
  it("relays a text response of an allowlisted operation after loadend", () => {
    const { target, postMessage } = makeHarness();
    FakeXhr.nextResponse = { status: 200, responseType: "", body: '{"data":{"xhr":1}}' };

    const xhr = new target.XMLHttpRequest();
    xhr.open("GET", `/i/api/graphql/${QUERY_ID}/TweetDetail?variables=%7B%7D`);
    xhr.send();

    expect(FakeXhr.opened).toEqual([`GET /i/api/graphql/${QUERY_ID}/TweetDetail?variables=%7B%7D`]);
    expect(FakeXhr.sent).toEqual([null]);
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      envelope(X_GRAPHQL_REQUEST_RELAY_KIND, "TweetDetail", null),
      ORIGIN,
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      envelope(X_GRAPHQL_RELAY_KIND, "TweetDetail", { data: { xhr: 1 } }),
      ORIGIN,
    );
  });

  it("relays an already parsed json response and skips other response types", () => {
    const { target, postMessage } = makeHarness();
    FakeXhr.nextResponse = { status: 200, responseType: "json", body: '{"data":{"xhr":2}}' };
    const parsed = new target.XMLHttpRequest();
    parsed.open("GET", timelineUrl);
    parsed.send();
    expect(postMessage).toHaveBeenLastCalledWith(
      envelope(X_GRAPHQL_RELAY_KIND, "HomeTimeline", { data: { xhr: 2 } }),
      ORIGIN,
    );

    FakeXhr.nextResponse = { status: 200, responseType: "blob", body: "{}" };
    const blob = new target.XMLHttpRequest();
    blob.open("GET", timelineUrl);
    blob.send();
    expect(postMessage).toHaveBeenCalledTimes(3);
  });

  it("drops a failed status and a body that is not JSON", () => {
    const { target, postMessage } = makeHarness();
    FakeXhr.nextResponse = { status: 429, responseType: "", body: "{}" };
    const limited = new target.XMLHttpRequest();
    limited.open("GET", timelineUrl);
    limited.send();
    FakeXhr.nextResponse = { status: 200, responseType: "", body: "<html>" };
    const garbage = new target.XMLHttpRequest();
    garbage.open("GET", timelineUrl);
    garbage.send();
    expect(postMessage).toHaveBeenCalledTimes(2);
    for (const call of postMessage.mock.calls) {
      expect(call[0]).toMatchObject({ kind: X_GRAPHQL_REQUEST_RELAY_KIND });
    }
  });

  it("leaves a url whose toString throws to the native open and sends without relaying", () => {
    const { target, postMessage } = makeHarness();
    const hostile: URL = new Proxy(new URL(timelineUrl), {
      get: (url, property) => {
        if (property === Symbol.toPrimitive || property === "toString") {
          throw new Error("page trap");
        }
        return Reflect.get(url, property);
      },
    });

    const xhr = new target.XMLHttpRequest();
    // The fake's open stringifies the url just as the native one does, so the trap surfaces there.
    expect(() => xhr.open("GET", hostile)).toThrow("page trap");
    expect(() => xhr.send()).not.toThrow();

    expect(FakeXhr.sent).toEqual([null]);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("reports the native names and lengths on the wrappers", () => {
    const { target } = makeHarness();
    expect(target.XMLHttpRequest.prototype.open.name).toBe("open");
    expect(target.XMLHttpRequest.prototype.open).toHaveLength(2);
    expect(target.XMLHttpRequest.prototype.send.name).toBe("send");
    expect(target.XMLHttpRequest.prototype.send).toHaveLength(1);
  });
});
