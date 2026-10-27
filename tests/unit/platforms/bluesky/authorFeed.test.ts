import { readFileSync } from "node:fs";
import { authorFeedPosts } from "../../../../src/platforms/bluesky/parsers/authorFeed";

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/bluesky/${name}`, import.meta.url), "utf8"),
  );
}

const author = { did: "did:plc:owner", handle: "Owner.Example.com" };

const item = (post: Record<string, unknown>, reason?: Record<string, unknown>) => ({
  post: { uri: "at://did:plc:owner/app.bsky.feed.post/1", author, ...post },
  ...(reason === undefined ? {} : { reason }),
});

describe("authorFeedPosts", () => {
  it("leaves out the recorded feed's repost, whose post is someone else's", () => {
    expect(authorFeedPosts(loadFixture("get-author-feed.json"))).toEqual([]);
  });

  it("reads each post's server time, keyed by DID and lowercased handle, in body order", () => {
    const body = {
      feed: [
        item({
          indexedAt: "2026-10-20T10:00:01.000Z",
          record: { createdAt: "2099-01-01T00:00:00Z" },
        }),
        item({
          indexedAt: "2026-10-21T10:00:01.000Z",
          record: { createdAt: "2026-10-21T10:00:00Z" },
        }),
        item({ indexedAt: "2026-10-19T10:00:01.000Z" }, { $type: "app.bsky.feed.defs#reasonPin" }),
      ],
    };
    expect(authorFeedPosts(body)).toEqual([
      {
        did: "did:plc:owner",
        handle: "owner.example.com",
        timestamps: [
          Date.parse("2026-10-20T10:00:01.000Z"),
          Date.parse("2026-10-21T10:00:01.000Z"),
          Date.parse("2026-10-19T10:00:01.000Z"),
        ],
      },
    ]);
  });

  it("falls back to the record's createdAt and skips posts with neither time", () => {
    const body = {
      feed: [
        item({ indexedAt: "soon", record: { createdAt: "2026-10-21T11:00:00.000Z" } }),
        item({ record: { createdAt: "yesterday" } }),
      ],
    };
    expect(authorFeedPosts(body)[0]?.timestamps).toEqual([Date.parse("2026-10-21T11:00:00.000Z")]);
  });

  it("leaves out reposts and items without a readable author", () => {
    const body = {
      feed: [
        item(
          { record: { createdAt: "2026-10-21T10:00:00.000Z" } },
          { $type: "app.bsky.feed.defs#reasonRepost" },
        ),
        { post: { author: { handle: "no-did.example.com" }, record: { createdAt: "2026-10-21" } } },
        { post: { author: { did: "did:plc:x", handle: " " }, indexedAt: "2026-10-21T10:00:00Z" } },
      ],
    };
    expect(authorFeedPosts(body)).toEqual([]);
  });

  it("reads at most 200 items of a body", () => {
    const feed = Array.from({ length: 300 }, (_, index) =>
      item({ indexedAt: new Date(Date.UTC(2026, 9, 1) + index * 60_000).toISOString() }),
    );
    expect(authorFeedPosts({ feed })[0]?.timestamps).toHaveLength(200);
  });

  it.each([null, undefined, 42, "feed", [], {}, { feed: "nope" }, { feed: [null, 3, "x"] }])(
    "returns nothing for %p",
    (body) => {
      expect(authorFeedPosts(body)).toEqual([]);
    },
  );
});
