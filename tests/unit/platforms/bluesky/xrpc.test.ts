import {
  FEED_OPERATIONS,
  PROFILE_OPERATIONS,
  xrpcOperationOf,
} from "../../../../src/platforms/bluesky/xrpc";

const BASE = "https://bsky.app/";

describe("xrpcOperationOf", () => {
  it.each([...FEED_OPERATIONS, ...PROFILE_OPERATIONS])("matches %s on any host", (operation) => {
    expect(xrpcOperationOf(`https://api.bsky.app/xrpc/${operation}?limit=30`, BASE)).toBe(
      operation,
    );
    expect(xrpcOperationOf(`https://pds.example.com/xrpc/${operation}`, BASE)).toBe(operation);
    expect(xrpcOperationOf(`/xrpc/${operation}`, BASE)).toBe(operation);
  });

  it.each([
    "https://api.bsky.app/xrpc/app.bsky.notification.listNotifications",
    "https://api.bsky.app/xrpc/app.bsky.feed.getTimelineExtra",
    "https://api.bsky.app/xrpc/com.atproto.server.createSession",
    "https://bsky.app/profile/alice.example.com",
    "https://api.bsky.app/app.bsky.feed.getTimeline",
    "not a url at all",
    "",
  ])("ignores %s", (url) => {
    expect(xrpcOperationOf(url, BASE)).toBeUndefined();
  });
});
