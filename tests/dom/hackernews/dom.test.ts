// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://news.ycombinator.com/"}

import type { HackerNewsPostRef } from "@/src/platforms/hackernews/dom";
import {
  FEED_ITEM_SELECTOR,
  classify,
  extractDomSignals,
  toPostRef,
} from "@/src/platforms/hackernews/dom";
import type { HackerNewsRecording } from "./fixtures";
import { DELETED_COMMENT_ROW, JOB_AD_ROWS, loadHackerNewsFixture, loadRows } from "./fixtures";

function postsOn(recording: HackerNewsRecording): HackerNewsPostRef[] {
  loadHackerNewsFixture(recording);
  return [...document.querySelectorAll(FEED_ITEM_SELECTOR)]
    .map(toPostRef)
    .filter((post): post is HackerNewsPostRef => post !== null);
}

const kinds = (posts: HackerNewsPostRef[]): Record<string, number> =>
  posts.reduce<Record<string, number>>((counts, post) => {
    counts[post.kind] = (counts[post.kind] ?? 0) + 1;
    return counts;
  }, {});

describe("Hacker News rows on the recordings", () => {
  it("finds every story author on the front page and /newest", () => {
    for (const recording of ["front", "newest"] as const) {
      const posts: HackerNewsPostRef[] = postsOn(recording);
      expect(kinds(posts)).toEqual({ post: 30 });
      for (const post of posts) {
        // The author sits in the row under the title, not in the story row itself.
        expect(post.element.contains(post.anchor)).toBe(false);
        expect(post.element.nextElementSibling?.contains(post.anchor)).toBe(true);
        expect(post.anchor.matches("a.hnuser")).toBe(true);
        expect(post.anchor.textContent).toBe(post.ref.handle);
        expect(post.isReply).toBe(false);
      }
    }
  });

  it("finds the story and every comment author in a thread, with replies told apart", () => {
    const posts: HackerNewsPostRef[] = postsOn("thread");
    expect(kinds(posts)).toEqual({ post: 1, comment: 82 });
    const comments: HackerNewsPostRef[] = posts.filter((post) => post.kind === "comment");
    for (const comment of comments) {
      expect(comment.element.contains(comment.anchor)).toBe(true);
      expect(comment.anchor.closest(".comhead")).not.toBeNull();
    }
    expect(comments.filter((comment) => comment.isReply)).toHaveLength(66);
    expect(new Set(posts.map((post) => post.ref.handle)).size).toBe(63);
  });

  it("finds every comment author on /newcomments and tells replies from its parent links", () => {
    const posts: HackerNewsPostRef[] = postsOn("newcomments");
    expect(kinds(posts)).toEqual({ comment: 30 });
    expect(new Set(posts.map((post) => post.ref.handle)).size).toBe(25);
    // The page's td.ind carries no indent; 23 of the 30 recorded comments answer another comment.
    expect(posts.filter((post) => post.isReply)).toHaveLength(23);
  });

  it("never treats the profile on a user page as a post", () => {
    loadHackerNewsFixture("user");
    const row: Element | null = document.querySelector(FEED_ITEM_SELECTOR);
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(classify(row)).toEqual({ status: "notPost" });
  });
});

describe("Hacker News edge rows (hand-written)", () => {
  it("classifies a job ad and a deleted comment as having no author, not as a miss", () => {
    loadRows(`${JOB_AD_ROWS}${DELETED_COMMENT_ROW}`);
    const [jobAd, deleted] = [...document.querySelectorAll(FEED_ITEM_SELECTOR)];
    expect(jobAd === undefined ? undefined : classify(jobAd)).toEqual({
      status: "noAuthor",
      kind: "post",
    });
    expect(deleted === undefined ? undefined : classify(deleted)).toEqual({
      status: "noAuthor",
      kind: "comment",
    });
  });

  it("classifies an author link without a readable username as a miss", () => {
    loadRows(
      `<tr class="athing comtr" id="1000006"><td><span class="comhead"><a href="user?id=a%20b" class="hnuser">a b</a></span><div class="comment">Hi</div></td></tr>`,
    );
    const row: Element | null = document.querySelector(FEED_ITEM_SELECTOR);
    expect(row === null ? undefined : classify(row)).toEqual({
      status: "unreadableAuthor",
      kind: "comment",
    });
  });

  it("keeps the casing of the username, which Hacker News treats as part of the id", () => {
    loadRows(
      `<tr class="athing comtr" id="1000003"><td><span class="comhead"><a href="user?id=CamelCase_42" class="hnuser">CamelCase_42</a></span><div class="comment">Hello</div></td></tr>`,
    );
    const row: Element | null = document.querySelector(FEED_ITEM_SELECTOR);
    const post: HackerNewsPostRef | null = row === null ? null : toPostRef(row);
    expect(post?.ref).toEqual({ platform: "hackernews", handle: "CamelCase_42" });
  });

  it("reads a username whose last word is bot as a declaration, and nothing else from the page", () => {
    loadRows(
      `<tr class="athing comtr" id="1000004"><td><span class="comhead"><a href="user?id=summary_bot" class="hnuser">summary_bot</a></span><div class="comment">TL;DR</div></td></tr>
       <tr class="athing comtr" id="1000005"><td><span class="comhead"><a href="user?id=talbot" class="hnuser">talbot</a></span><div class="comment">Hi</div></td></tr>`,
    );
    const [declared, person] = [...document.querySelectorAll(FEED_ITEM_SELECTOR)]
      .map(toPostRef)
      .filter((post): post is HackerNewsPostRef => post !== null);
    expect(declared === undefined ? {} : extractDomSignals(declared)).toEqual({
      displayName: "summary_bot",
      declaredAutomated: true,
      declaredBy: "name",
    });
    expect(person === undefined ? {} : extractDomSignals(person)).toEqual({
      displayName: "talbot",
    });
  });
});
