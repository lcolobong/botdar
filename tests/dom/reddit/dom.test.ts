// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/"}

import type { RedditPostRef } from "@/src/platforms/reddit/dom";
import {
  authorNameOf,
  densityFor,
  extractDomSignals,
  findAuthorAnchor,
  kindOf,
  toPostRef,
} from "@/src/platforms/reddit/dom";
import { OLD_REDDIT_COMMENT_THREAD, OLD_REDDIT_POST, loadRedditFixture, snippet } from "./fixtures";

function post(index: number): Element {
  const element: Element | undefined = document.querySelectorAll("shreddit-post")[index];
  if (element === undefined) throw new Error(`no post at ${index}`);
  return element;
}

function comment(author: string): Element {
  const element: Element | null = document.querySelector(`shreddit-comment[author="${author}"]`);
  if (element === null) throw new Error(`no comment by ${author}`);
  return element;
}

function refOf(element: Element): RedditPostRef {
  const ref: RedditPostRef | null = toPostRef(element);
  if (ref === null) throw new Error("expected a post ref");
  return ref;
}

describe("feed fixture", () => {
  beforeEach(() => loadRedditFixture("feed.html"));

  it("hydrates the declarative shadow roots", () => {
    expect(post(0).shadowRoot).not.toBeNull();
    expect(post(0).querySelector("template")).toBeNull();
  });

  it("classifies posts and reads the author attribute with its casing", () => {
    expect(kindOf(post(0))).toBe("post");
    expect(authorNameOf(post(0))).toBe("Quiet_Lantern_4821");
    expect(densityFor("post")).toBe("reddit-post");
  });

  it("anchors on the slotted credit-bar author link, absolute as the live site writes it", () => {
    const anchor: Element | null = findAuthorAnchor(post(0), "post");
    expect(anchor?.getAttribute("href")).toBe("https://www.reddit.com/user/Quiet_Lantern_4821/");
    expect(anchor?.getRootNode()).toBe(document);
  });

  it("falls back to the shadow root when nothing is slotted", () => {
    const anchor: Element | null = findAuthorAnchor(post(1), "post");
    expect(anchor?.getAttribute("href")).toBe("/user/Brisk_Falcon_2210/");
    expect(anchor?.getRootNode()).toBe(post(1).shadowRoot);
  });

  it("builds a PostRef with the lowercased handle", () => {
    expect(refOf(post(0))).toMatchObject({
      kind: "post",
      ref: { platform: "reddit", handle: "quiet_lantern_4821" },
      isReply: false,
    });
    expect(refOf(post(0)).nativeLabel).toBeUndefined();
    expect(refOf(post(1)).nativeLabel).toBe("automated");
  });

  it("extracts Tier 0 signals and never maps created-timestamp to account age", () => {
    expect(extractDomSignals(refOf(post(0)))).toEqual({ displayName: "Quiet_Lantern_4821" });
    expect(extractDomSignals(refOf(post(1)))).toEqual({
      displayName: "Brisk_Falcon_2210",
      declaredAutomated: true,
      hasDefaultAvatar: true,
    });
  });
});

describe("comments fixture", () => {
  beforeEach(() => loadRedditFixture("comments.html"));

  it("anchors each comment on its own slotted meta row, not a reply's", () => {
    const top: RedditPostRef = refOf(comment("Mossy_Teapot"));
    expect(top.kind).toBe("comment");
    expect(top.isReply).toBe(false);
    expect(top.anchor.getAttribute("href")).toBe("/user/Mossy_Teapot/");
    expect(top.anchor.parentElement?.parentElement?.parentElement).toBe(top.element);
  });

  it("marks nested comments as replies", () => {
    expect(refOf(comment("Quiet_Lantern_4821")).isReply).toBe(true);
    expect(refOf(comment("Deal_Scout_90210")).isReply).toBe(true);
    expect(densityFor("comment")).toBe("reddit-comment");
  });

  it("reads the avatar from the author link image", () => {
    expect(extractDomSignals(refOf(comment("Mossy_Teapot"))).hasDefaultAvatar).toBe(false);
    expect(extractDomSignals(refOf(comment("Deal_Scout_90210"))).hasDefaultAvatar).toBe(true);
    expect(extractDomSignals(refOf(comment("Quiet_Lantern_4821")))).not.toHaveProperty(
      "hasDefaultAvatar",
    );
  });

  it("skips a deleted author", () => {
    expect(authorNameOf(comment("[deleted]"))).toBeUndefined();
    expect(toPostRef(comment("[deleted]"))).toBeNull();
  });
});

describe("live post page markup (2026-10-25)", () => {
  // Trimmed from a real www.reddit.com post page: the credit bar links to the community twice and
  // to the author once, all with absolute URLs, and nothing is relative.
  const live = (): Element =>
    snippet(`
      <shreddit-post author="Den_Hviide" id="t3_1xemeku">
        <div slot="credit-bar" id="pdp-credit-bar" class="flex justify-between">
          <span class="avatar">
            <faceplate-tracker source="post_credit_bar" action="click" noun="community">
              <a href="https://www.reddit.com/r/SubSimGPT2Interactive/"><img src="https://styles.redditmedia.com/icon.png" alt="" /></a>
            </faceplate-tracker>
          </span>
          <div class="flex" role="group">
            <a href="https://www.reddit.com/r/SubSimGPT2Interactive/">r/SubSimGPT2Interactive</a>
            <faceplate-tracker source="post_credit_bar" action="click" noun="user_profile">
              <a href="https://www.reddit.com/user/Den_Hviide/">u/Den_Hviide</a>
            </faceplate-tracker>
          </div>
        </div>
      </shreddit-post>`);

  it("anchors on the absolute author link, not the community links", () => {
    const anchor: Element | null = findAuthorAnchor(live(), "post");
    expect(anchor?.getAttribute("href")).toBe("https://www.reddit.com/user/Den_Hviide/");
    expect(refOf(live()).ref.handle).toBe("den_hviide");
  });

  it("accepts the short /u/ form and ignores profile-looking links on other hosts", () => {
    const mixed: Element = snippet(`
      <shreddit-post author="Short_Form">
        <div slot="credit-bar">
          <a href="https://example.com/user/Short_Form/">elsewhere</a>
          <a href="/u/Short_Form">u/Short_Form</a>
        </div>
      </shreddit-post>`);
    expect(findAuthorAnchor(mixed, "post")?.getAttribute("href")).toBe("/u/Short_Form");
  });
});

describe("app tag", () => {
  it("accepts the guessed selectors", () => {
    const tagged: Element = snippet(`
      <shreddit-post author="Tag_Bot_1">
        <div slot="credit-bar">
          <a href="/user/Tag_Bot_1/">u/Tag_Bot_1</a>
          <shreddit-tag type="app">registered app</shreddit-tag>
        </div>
      </shreddit-post>`);
    expect(refOf(tagged).nativeLabel).toBe("automated");
    expect(extractDomSignals(refOf(tagged)).declaredAutomated).toBe(true);
  });

  it("does not fire on text that merely contains APP", () => {
    const plain: Element = snippet(`
      <shreddit-post author="Happy_User">
        <div slot="credit-bar">
          <a href="/user/Happy_User/">u/Happy_User</a>
          <span>APPLE pie thread</span>
        </div>
      </shreddit-post>`);
    expect(refOf(plain).nativeLabel).toBeUndefined();
    expect(extractDomSignals(refOf(plain))).not.toHaveProperty("declaredAutomated");
  });

  it("finds a bare APP leaf in the author row", () => {
    const tagged: Element = snippet(`
      <shreddit-comment author="Leaf_Bot_2">
        <div slot="commentMeta">
          <a href="/user/Leaf_Bot_2/">Leaf_Bot_2</a>
          <span><span> APP </span></span>
        </div>
      </shreddit-comment>`);
    expect(refOf(tagged).nativeLabel).toBe("automated");
  });

  it("searches for the tag once per item and trusts the PostRef afterwards", () => {
    const tagged: Element = snippet(`
      <shreddit-post author="Leaf_Bot_3">
        <div slot="credit-bar">
          <a href="/user/Leaf_Bot_3/">u/Leaf_Bot_3</a>
          <span>APP</span>
        </div>
      </shreddit-post>`);
    const leafWalks = vi.spyOn(Element.prototype, "querySelectorAll");
    const ref: RedditPostRef = refOf(tagged);
    const signals = extractDomSignals(ref);
    const walks: number = leafWalks.mock.calls.filter(([selector]) => selector === "*").length;
    leafWalks.mockRestore();

    expect(walks).toBe(1);
    expect(signals.declaredAutomated).toBe(true);
    const { nativeLabel, ...unlabelled } = ref;
    expect(nativeLabel).toBe("automated");
    expect(extractDomSignals(unlabelled)).not.toHaveProperty("declaredAutomated");
  });

  it("skips the leaf walk when the row text has no APP in it", () => {
    const untagged: Element = snippet(`
      <shreddit-post author="Quiet_User_4">
        <div slot="credit-bar">
          <a href="/user/Quiet_User_4/">u/Quiet_User_4</a>
          <span>5h ago</span>
        </div>
      </shreddit-post>`);
    const leafWalks = vi.spyOn(Element.prototype, "querySelectorAll");
    extractDomSignals(refOf(untagged));
    const walks: number = leafWalks.mock.calls.filter(([selector]) => selector === "*").length;
    leafWalks.mockRestore();

    expect(walks).toBe(0);
  });
});

describe("old.reddit", () => {
  it("reads a link thing", () => {
    const ref: RedditPostRef = refOf(snippet(OLD_REDDIT_POST));
    expect(ref).toMatchObject({
      kind: "post",
      ref: { handle: "quiet_lantern_4821" },
      isReply: false,
    });
    expect(ref.anchor.classList.contains("author")).toBe(true);
    expect(extractDomSignals(ref)).toEqual({ displayName: "Quiet_Lantern_4821" });
  });

  it("reads nested comment things and anchors each on its own tagline", () => {
    const thread: Element = snippet(OLD_REDDIT_COMMENT_THREAD);
    const parent: RedditPostRef = refOf(thread);
    const nested: Element | null = thread.querySelector('.thing[data-author="Deal_Scout_90210"]');
    if (nested === null) throw new Error("nested comment missing");
    const child: RedditPostRef = refOf(nested);
    expect(parent.kind).toBe("comment");
    expect(parent.isReply).toBe(false);
    expect(parent.anchor.textContent).toBe("Mossy_Teapot");
    expect(child.isReply).toBe(true);
    expect(child.anchor.textContent).toBe("Deal_Scout_90210");
  });

  it("ignores elements that are not posts", () => {
    expect(kindOf(snippet("<div class='entry'></div>"))).toBeUndefined();
    expect(toPostRef(snippet("<article><a href='/user/x/'>x</a></article>"))).toBeNull();
    expect(toPostRef(snippet('<shreddit-post author="Nowhere_1"></shreddit-post>'))).toBeNull();
  });
});
