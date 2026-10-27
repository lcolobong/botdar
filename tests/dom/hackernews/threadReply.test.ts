// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://news.ycombinator.com/item?id=36386524"}

import type { ThreadReply } from "@/src/core/thread/threadIndex";
import { ThreadIndex } from "@/src/core/thread/threadIndex";
import { FEED_ITEM_SELECTOR, parentItemIdOf } from "@/src/platforms/hackernews/dom";
import {
  threadKeyOf,
  threadReplyOf,
  threadRootLinksOf,
} from "@/src/platforms/hackernews/threadReply";
import { loadHackerNewsFixture, loadRows } from "./fixtures";

const THREAD_URL = new URL("https://news.ycombinator.com/item?id=36386524");

function row(id: string): Element {
  const found: Element | null = document.getElementById(id);
  if (found === null) {
    throw new Error(`no row ${id}`);
  }
  return found;
}

/** A thread comment row in the recorded shape. Hand-written. */
function commentRow(
  id: string,
  author: string,
  time: string,
  text: string,
  parent?: string,
): string {
  const parentLink: string =
    parent === undefined ? "" : `<a href="#${parent}" class="clicky">parent</a> | `;
  return `<tr class="athing comtr" id="${id}"><td><table><tbody><tr><td class="ind" indent="${parent === undefined ? 0 : 1}"></td><td class="default"><div><span class="comhead"><a href="user?id=${author}" class="hnuser">${author}</a> <span class="age" title="${time}"><a href="item?id=${id}">1 hour ago</a></span><span class="navs"> | ${parentLink}<a href="#" class="clicky">next</a></span></span></div><br><div class="comment"><div class="commtext c00">${text}</div></div></td></tr></tbody></table></td></tr>`;
}

describe("Hacker News thread replies on the recorded thread", () => {
  beforeEach(() => loadHackerNewsFixture("thread"));

  it("keys the thread on the item the page names, only on item pages", () => {
    expect(threadKeyOf(THREAD_URL)).toBe("36386524");
    expect(threadKeyOf(new URL("https://news.ycombinator.com/newcomments"))).toBeUndefined();
  });

  it("reads a top-level comment's author, time and text", () => {
    expect(threadReplyOf(row("32157534"), THREAD_URL)).toEqual({
      threadKey: "36386524",
      replyId: "32157534",
      author: "jonas_draws01",
      text: expect.stringContaining("I've got a question.") as string,
      postedAt: Date.parse("2026-10-26T18:05:03Z"),
    });
  });

  it("reads a reply's parent from its in-page parent link", () => {
    expect(parentItemIdOf(row("31731367"))).toBe("32157534");
    expect(threadReplyOf(row("31731367"), THREAD_URL)?.parentId).toBe("32157534");
  });

  it("never records the story at the head of the thread", () => {
    expect(threadReplyOf(row("36386524"), THREAD_URL)).toBeUndefined();
  });

  it("reads the absolute links in a comment's text", () => {
    expect(threadReplyOf(row("39633249"), THREAD_URL)?.links).toEqual([
      "https://bun.com/blog/bun-in-rust",
      "https://learn.chatgpt.com/docs/agent-configuration/subagents?surface=app",
    ]);
    expect(threadReplyOf(row("32157534"), THREAD_URL)).not.toHaveProperty("links");
  });

  it("reads the story's title link as the root's links, and no other row's", () => {
    expect(threadRootLinksOf(row("36386524"), THREAD_URL)).toEqual({
      threadKey: "36386524",
      links: ["https://magazine.sebastianraschka.com/p/building-reasoning-models"],
    });
    expect(threadRootLinksOf(row("39633249"), THREAD_URL)).toBeUndefined();
    expect(
      threadRootLinksOf(row("36386524"), new URL("https://news.ycombinator.com/news")),
    ).toBeUndefined();
  });

  it("reads the links in an Ask story's text as the root's too", () => {
    document
      .querySelector(".fatitem .toptext")
      ?.insertAdjacentHTML("beforeend", '<p><a href="https://example-lab.org/paper">paper</a></p>');
    expect(threadRootLinksOf(row("36386524"), THREAD_URL)?.links).toContain(
      "https://example-lab.org/paper",
    );
  });

  it("leaves a quoted paragraph out of a comment", () => {
    const quoting: Element | undefined = [...document.querySelectorAll(".commtext")].find(
      (text) => text.querySelector("p")?.textContent?.startsWith(">") === true,
    );
    const reply: ThreadReply | undefined = threadReplyOf(
      quoting?.closest(FEED_ITEM_SELECTOR) as Element,
      THREAD_URL,
    );
    const quoted: string = quoting?.querySelector("p")?.textContent ?? "";
    expect(quoted.length).toBeGreaterThan(1);
    expect(reply?.text).not.toContain(quoted);
  });
});

describe("Hacker News copied comments", () => {
  const TEXT =
    "This course is exactly what I needed to finally understand how reasoning models work.";

  beforeEach(() => {
    loadRows(
      [
        commentRow("2001", "original_poster", "2026-10-26T18:00:00", TEXT),
        commentRow("2002", "copier_one", "2026-10-26T18:30:00 1793039400", `${TEXT}!!`),
        commentRow("2003", "copier_two", "2026-10-26T19:00:00", TEXT.replace("finally", "really")),
        commentRow(
          "2004",
          "answerer",
          "2026-10-26T19:30:00",
          `<p>&gt; ${TEXT}</p><p>Same here.</p>`,
          "2001",
        ),
      ].join(""),
    );
  });

  it("counts the copies when the page is indexed", () => {
    const index = new ThreadIndex();
    for (const item of document.querySelectorAll(FEED_ITEM_SELECTOR)) {
      const reply: ThreadReply | undefined = threadReplyOf(item, THREAD_URL);
      if (reply !== undefined) {
        index.record(reply);
      }
    }
    expect(index.copiedReplyCount("original_poster")).toBe(0);
    expect(index.copiedReplyCount("copier_one")).toBe(1);
    expect(index.copiedReplyCount("copier_two")).toBe(2);
    expect(index.copiedReplyCount("answerer")).toBeUndefined();
  });

  it("reads a title that also carries the Unix time", () => {
    expect(threadReplyOf(row("2002"), THREAD_URL)?.postedAt).toBe(
      Date.parse("2026-10-26T18:30:00Z"),
    );
  });
});
