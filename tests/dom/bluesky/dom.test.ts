// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://bsky.app/"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PostRef } from "@/src/core/types";
import {
  POST_SELECTOR,
  UNMARKED_POST_SELECTOR,
  authorHandleOf,
  extractDomSignals,
  toPostRef,
} from "@/src/platforms/bluesky/dom";

const FEED_HTML: string = readFileSync(
  join(import.meta.dirname, "..", "..", "fixtures", "bluesky", "html", "feed.html"),
  "utf8",
);

const postByHandle = (handle: string): Element => {
  const element: Element | null = document.querySelector(`[data-testid$="-by-${handle}"]`);
  if (element === null) {
    throw new Error(`no post for ${handle}`);
  }
  return element;
};

const refFor = (handle: string): PostRef => {
  const post: PostRef | undefined = toPostRef(postByHandle(handle));
  if (post === undefined) {
    throw new Error(`no PostRef for ${handle}`);
  }
  return post;
};

beforeEach(() => {
  document.documentElement.innerHTML = FEED_HTML;
});

describe("post selectors", () => {
  it("finds feed and thread items, and skips marked ones when asked", () => {
    expect(document.querySelectorAll(POST_SELECTOR)).toHaveLength(6);
    const unmarked: string[] = [...document.querySelectorAll(UNMARKED_POST_SELECTOR)].map(
      (element) => element.getAttribute("data-testid") ?? "",
    );
    expect(unmarked).not.toContain("feedItem-by-marked.example.com");
    expect(unmarked).toHaveLength(5);
  });
});

describe("authorHandleOf", () => {
  it("reads the handle from the test id suffix, lowercased", () => {
    const post = document.createElement("div");
    post.dataset.testid = "feedItem-by-Alice.Example.COM";
    expect(authorHandleOf(post)).toBe("alice.example.com");
    post.dataset.testid = "postThreadItem-by-newsroom.example.org";
    expect(authorHandleOf(post)).toBe("newsroom.example.org");
  });

  it.each(["feedItem-by-", "feedItem-by-did:plc:abc", "feedItem-by-nodots", "other-by-a.b", ""])(
    "rejects %s",
    (testId) => {
      const post = document.createElement("div");
      post.dataset.testid = testId;
      expect(authorHandleOf(post)).toBeUndefined();
    },
  );
});

describe("toPostRef", () => {
  it("anchors on the handle link when the link's whole text is the handle", () => {
    const post: PostRef = refFor("alice.example.com");
    expect(post.ref).toEqual({ platform: "bluesky", handle: "alice.example.com" });
    expect(post.anchor.tagName).toBe("A");
    expect(post.anchor.textContent?.trim()).toBe("@alice.example.com");
  });

  it("anchors on the innermost handle element when name and handle share a link", () => {
    const post: PostRef = refFor("kai09127364.bsky.social");
    expect(post.anchor.tagName).toBe("SPAN");
    expect(post.anchor.textContent).toBe("@kai09127364.bsky.social");
    expect(post.anchor.closest('[data-testid^="feedItem-by-"]')).toBe(post.element);
  });

  it("ignores the reposter's link and query strings on the author's links", () => {
    const post: PostRef = refFor("newsroom.example.org");
    expect(post.anchor.textContent?.trim()).toBe("@newsroom.example.org");
    expect(post.anchor.closest(".repost-row")).toBeNull();
  });

  it("returns undefined without an author link or a usable handle", () => {
    expect(toPostRef(postByHandle("orphan.example.com"))).toBeUndefined();
    const invalid: Element | null = document.querySelector('[data-testid="feedItem-by-"]');
    expect(invalid).not.toBeNull();
    expect(toPostRef(invalid as Element)).toBeUndefined();
  });

  it("falls back to the first author link when no element shows the handle", () => {
    const post: Element = postByHandle("alice.example.com");
    post.querySelectorAll("a").forEach((link) => {
      if (link.textContent?.includes("@")) link.remove();
    });
    const ref: PostRef | undefined = toPostRef(post);
    expect(ref?.anchor.getAttribute("aria-label")).toBe("Alice Example's avatar");
  });
});

describe("extractDomSignals", () => {
  it("reads the display name and an image avatar", () => {
    expect(extractDomSignals(refFor("alice.example.com"))).toEqual({
      displayName: "Alice Example",
      hasDefaultAvatar: false,
    });
  });

  it("reads the fallback avatar and the robot badge, stripping the handle from the name", () => {
    expect(extractDomSignals(refFor("kai09127364.bsky.social"))).toEqual({
      displayName: "Kai",
      hasDefaultAvatar: true,
      declaredAutomated: true,
    });
  });

  it("does not attribute a quoted author's avatar or badge to the post's author", () => {
    expect(extractDomSignals(refFor("newsroom.example.org"))).toEqual({
      displayName: "Example Newsroom",
      hasDefaultAvatar: false,
    });
  });

  it("leaves avatar and declared state unknown when neither element is rendered", () => {
    const post: Element = postByHandle("alice.example.com");
    post.querySelector('[data-testid="userAvatarImage"]')?.remove();
    expect(extractDomSignals(refFor("alice.example.com"))).toEqual({
      displayName: "Alice Example",
    });
  });

  it("ignores a hidden robot badge and caps the display name", () => {
    const post: Element = postByHandle("kai09127364.bsky.social");
    const badge = post.querySelector('[data-testid="botBadge"]') as HTMLElement;
    badge.hidden = true;
    const name = post.querySelector(".author-row span") as HTMLElement;
    name.textContent = "K".repeat(150);
    const signals = extractDomSignals(refFor("kai09127364.bsky.social"));
    expect(signals.declaredAutomated).toBeUndefined();
    expect(signals.displayName).toHaveLength(100);
  });
});
