// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://bsky.app/profile/citypaper.example.com/post/3mytupxwd222b"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThreadReply } from "@/src/core/thread/threadIndex";
import { ThreadIndex } from "@/src/core/thread/threadIndex";
import { POST_SELECTOR } from "@/src/platforms/bluesky/dom";
import { threadKeyOf, threadReplyOf, tidMillis } from "@/src/platforms/bluesky/threadReply";

const THREAD_URL = new URL("https://bsky.app/profile/citypaper.example.com/post/3mytupxwd222b");

function items(): Element[] {
  return [...document.querySelectorAll(POST_SELECTOR)];
}

function itemBy(handle: string): Element {
  const found: Element | null = document.querySelector(`[data-testid$="-by-${handle}"]`);
  if (found === null) {
    throw new Error(`no item by ${handle}`);
  }
  return found;
}

beforeEach(() => {
  const html: string = readFileSync(
    join(process.cwd(), "tests/fixtures/bluesky/html/thread.html"),
    "utf8",
  );
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? html;
});

describe("Bluesky thread replies", () => {
  it("reads the time a TID record key encodes", () => {
    expect(new Date(tidMillis("3mytupxwd222b") ?? 0).toISOString()).toBe(
      "2026-10-27T09:00:00.000Z",
    );
    expect(tidMillis("not-a-tid")).toBeUndefined();
    expect(tidMillis("3MYTUPXWD222B")).toBeUndefined();
  });

  it("keys the thread on the post the page names, and nothing else", () => {
    expect(threadKeyOf(THREAD_URL)).toBe("3mytupxwd222b");
    expect(threadKeyOf(new URL("https://bsky.app/"))).toBeUndefined();
    expect(threadKeyOf(new URL("https://bsky.app/profile/alice.example.com"))).toBeUndefined();
  });

  it("reads a reply's author, key, time and text", () => {
    expect(threadReplyOf(itemBy("alice.example.com"), THREAD_URL)).toEqual({
      threadKey: "3mytupxwd222b",
      replyId: "alice.example.com/3mytutkegk22b",
      author: "alice.example.com",
      text: expect.stringContaining("Honestly the new bike lanes") as string,
      postedAt: Date.parse("2026-10-27T09:02:00.000Z"),
    });
  });

  it("never records the root or an ancestor", () => {
    const [ancestor, root] = items();
    expect(threadReplyOf(ancestor as Element, THREAD_URL)).toBeUndefined();
    expect(threadReplyOf(root as Element, THREAD_URL)).toBeUndefined();
  });

  it("records nothing on a feed", () => {
    expect(threadReplyOf(itemBy("alice.example.com"), new URL("https://bsky.app/"))).toBe(
      undefined,
    );
  });

  it("counts the copies when the whole page is indexed", () => {
    const index = new ThreadIndex();
    for (const item of items()) {
      const reply: ThreadReply | undefined = threadReplyOf(item, THREAD_URL);
      if (reply !== undefined) {
        index.record(reply);
      }
    }
    expect(index.copiedReplyCount("alice.example.com")).toBe(0);
    expect(index.copiedReplyCount("kai.bsky.social")).toBe(1);
    expect(index.copiedReplyCount("mila48213907.bsky.social")).toBe(2);
    expect(index.copiedReplyCount("maria.example.com")).toBe(0);
    expect(index.copiedReplyCount("citypaper.example.com")).toBeUndefined();
  });
});
