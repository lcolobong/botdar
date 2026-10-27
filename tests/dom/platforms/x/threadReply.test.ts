// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/city_paper/status/2115005580702646272"}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThreadReply } from "@/src/core/thread/threadIndex";
import { ThreadIndex } from "@/src/core/thread/threadIndex";
import { POST_SELECTOR } from "@/src/platforms/x/dom";
import type { XReplyReader } from "@/src/platforms/x/threadReply";
import {
  createXReplyReader,
  snowflakeMillis,
  threadKeyOf,
  threadReplyOf,
} from "@/src/platforms/x/threadReply";

const THREAD_URL = new URL("https://x.com/city_paper/status/2115005580702646272");
const ROOT_ID = "2115005580702646272";

function loadThread(): void {
  const html: string = readFileSync(
    join(process.cwd(), "tests/fixtures/x/html/thread.html"),
    "utf8",
  );
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? html;
}

function articles(): Element[] {
  return [...document.querySelectorAll(POST_SELECTOR)];
}

function articleBy(handle: string): Element {
  const found: Element | undefined = articles().find(
    (article) => article.querySelector(`a[href="/${handle}"]`) !== null,
  );
  if (found === undefined) {
    throw new Error(`no article by ${handle}`);
  }
  return found;
}

beforeEach(loadThread);

describe("X thread replies", () => {
  it("keys the thread on the status the page names, and nothing else", () => {
    expect(threadKeyOf(THREAD_URL)).toBe(ROOT_ID);
    expect(threadKeyOf(new URL("https://x.com/city_paper/status/1/photo/1"))).toBe("1");
    expect(threadKeyOf(new URL("https://x.com/home"))).toBeUndefined();
    expect(threadKeyOf(new URL("https://x.com/city_paper"))).toBeUndefined();
  });

  it("reads the time a snowflake id was assigned", () => {
    expect(new Date(snowflakeMillis(ROOT_ID)).toISOString()).toBe("2026-10-27T09:00:00.000Z");
  });

  it("reads a reply's author, id, time and text", () => {
    expect(threadReplyOf(articleBy("maria_dev"), THREAD_URL)).toEqual({
      threadKey: ROOT_ID,
      replyId: "2115006084019126272",
      author: "maria_dev",
      text: expect.stringContaining("Honestly the new bike lanes on Main Street") as string,
      postedAt: Date.parse("2026-10-27T09:02:00.000Z"),
    });
  });

  it("records a reply with no text, whose links arrive from Tier 1", () => {
    const reply: Element | undefined = articles().find(
      (article) => threadReplyOf(article, THREAD_URL) !== undefined,
    );
    reply?.querySelector('[data-testid="tweetText"]')?.remove();
    expect(threadReplyOf(reply as Element, THREAD_URL)?.text).toBe("");
  });

  it("never records the root or an ancestor", () => {
    const [ancestor, root] = articles();
    expect(threadReplyOf(ancestor as Element, THREAD_URL)).toBeUndefined();
    expect(threadReplyOf(root as Element, THREAD_URL)).toBeUndefined();
  });

  it("records nothing outside a post page", () => {
    expect(threadReplyOf(articleBy("maria_dev"), new URL("https://x.com/home"))).toBeUndefined();
  });

  it("reads a quoting reply's own words and id, not the quoted post's", () => {
    const quoting: ThreadReply | undefined = threadReplyOf(articleBy("jo_quotes"), THREAD_URL);
    expect(quoting?.replyId).toBe("2115009355576246272");
    expect(quoting?.text).toContain("Exactly this");
    expect(quoting?.text).not.toContain("bike lanes");
  });

  it("counts the copies when the whole page is indexed", () => {
    const index = new ThreadIndex();
    for (const article of articles()) {
      const reply: ThreadReply | undefined = threadReplyOf(article, THREAD_URL);
      if (reply !== undefined) {
        index.record(reply);
      }
    }
    expect(index.copiedReplyCount("maria_dev")).toBe(0);
    expect(index.copiedReplyCount("kai09127364")).toBe(1);
    expect(index.copiedReplyCount("mila48213907")).toBe(2);
    expect(index.copiedReplyCount("tomas_bakes")).toBe(0);
    expect(index.copiedReplyCount("jo_quotes")).toBeUndefined();
    expect(index.copiedReplyCount("city_paper")).toBeUndefined();
    expect(index.copiedReplyCount("bike_deals")).toBeUndefined();
    expect(index.copiedReplyCount("viral_clips")).toBeUndefined();
  });

  it("turns away a promoted post and posts below the conversation, though their ids are newer", () => {
    expect(threadReplyOf(articleBy("bike_deals"), THREAD_URL)).toBeUndefined();
    expect(threadReplyOf(articleBy("viral_clips"), THREAD_URL)).toBeUndefined();
  });

  it("keeps posts below the closing heading off the thread after the heading leaves the DOM", () => {
    const reader: XReplyReader = createXReplyReader(window);
    const belowConversation: Element = articleBy("viral_clips");
    expect(reader.read(articleBy("maria_dev"))?.author).toBe("maria_dev");
    document.querySelector('[role="heading"]')?.closest('[data-testid="cellInnerDiv"]')?.remove();
    expect(reader.read(belowConversation)).toBeUndefined();
    reader.reset();
    expect(reader.read(belowConversation)?.author).toBe("viral_clips");
  });
});
