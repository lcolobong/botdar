// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}

import type { PostRef } from "@/src/core/types";
import {
  BADGED_ATTRIBUTE,
  extractDomSignals,
  findUnbadgedPosts,
  markBadged,
  toPostRef,
  unmarkBadged,
} from "@/src/platforms/x/dom";
import { loadTimeline, timelineArticles } from "./timelineFixture";

function postAt(index: number): PostRef {
  const article: Element | undefined = timelineArticles()[index];
  const post: PostRef | undefined = article === undefined ? undefined : toPostRef(article);
  if (post === undefined) throw new Error(`fixture post ${index} did not resolve`);
  return post;
}

beforeEach(() => {
  loadTimeline();
});

describe("findUnbadgedPosts and the badged mark", () => {
  it("finds every tweet article and skips the ones already badged", () => {
    const articles: Element[] = timelineArticles();
    expect(findUnbadgedPosts(document)).toEqual(articles);
    const [first] = articles;
    if (first === undefined) throw new Error("fixture has no posts");
    markBadged(first);
    expect(first.getAttribute(BADGED_ATTRIBUTE)).toBe("1");
    expect(findUnbadgedPosts(document)).toEqual(articles.slice(1));
    unmarkBadged(first);
    expect(findUnbadgedPosts(document)).toHaveLength(4);
  });
});

describe("toPostRef", () => {
  it("reads the handle from the @ link and anchors on that link's row element", () => {
    const post: PostRef = postAt(0);
    expect(post.ref).toEqual({ platform: "x", handle: "alice_example" });
    expect(post.element).toBe(timelineArticles()[0]);
    const handleLink: Element | null = post.anchor.querySelector("a");
    expect(handleLink?.textContent?.trim()).toBe("@alice_example");
    expect(post.anchor.parentElement?.textContent).toContain("·");
    expect(post.isReply).toBeUndefined();
    expect(post.nativeLabel).toBeUndefined();
  });

  it("lowercases a mixed-case handle and flags the Replying to row", () => {
    const post: PostRef = postAt(2);
    expect(post.ref.handle).toBe("maria_dev");
    expect(post.isReply).toBe(true);
    expect(post.nativeLabel).toBeUndefined();
  });

  it("flags the Automated label row", () => {
    const post: PostRef = postAt(1);
    expect(post.ref.handle).toBe("kai09127364");
    expect(post.nativeLabel).toBe("automated");
    expect(post.isReply).toBeUndefined();
  });

  it("ignores the word in the post text and an article without an author row", () => {
    const article: Element | undefined = timelineArticles()[2];
    expect(article?.textContent).toContain("Automated reading lists");
    expect(postAt(2).nativeLabel).toBeUndefined();

    const orphan: HTMLElement = document.createElement("article");
    orphan.dataset.testid = "tweet";
    orphan.innerHTML = '<div data-testid="User-Name"><a href="/x">Name only</a></div>';
    expect(toPostRef(orphan)).toBeUndefined();
    orphan.innerHTML = "";
    expect(toPostRef(orphan)).toBeUndefined();
  });
});

describe("extractDomSignals", () => {
  it("reads the display name and a real avatar", () => {
    expect(extractDomSignals(postAt(0))).toEqual({
      displayName: "Alice Example",
      hasDefaultAvatar: false,
    });
  });

  it("reads the default avatar and the Automated label", () => {
    expect(extractDomSignals(postAt(1))).toEqual({
      displayName: "Kai",
      hasDefaultAvatar: true,
      declaredAutomated: true,
    });
  });

  it("leaves the avatar unobserved when no image is rendered", () => {
    const post: PostRef = postAt(2);
    post.element.querySelector('[data-testid="Tweet-User-Avatar"]')?.remove();
    expect(extractDomSignals(post)).toEqual({ displayName: "Maria 🛠️" });
  });
});
