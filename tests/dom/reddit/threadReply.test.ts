// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/r/woodworking/comments/1k9x2ab/finished_the_walnut_side_table/"}

import type { ReplyReading } from "@/src/core/thread/replyText";
import { NOT_YET_READABLE } from "@/src/core/thread/replyText";
import type { ThreadReply } from "@/src/core/thread/threadIndex";
import { ThreadIndex } from "@/src/core/thread/threadIndex";
import { FEED_ITEM_SELECTOR } from "@/src/platforms/reddit/dom";
import { threadReplyOf } from "@/src/platforms/reddit/threadReply";
import { loadRedditFixture } from "./fixtures";

function itemBy(author: string): Element {
  const found: Element | null = document.querySelector(`[author="${author}"]`);
  if (found === null) {
    throw new Error(`no item by ${author}`);
  }
  return found;
}

/** The reading as a reply; fails the test when the element was not readable yet. */
function readReply(element: Element): ThreadReply | undefined {
  const reading: ReplyReading = threadReplyOf(element);
  if (reading === NOT_YET_READABLE) {
    throw new Error("comment not readable yet");
  }
  return reading;
}

beforeEach(() => loadRedditFixture("copied-replies.html"));

describe("Reddit thread replies", () => {
  it("reads a comment's thread, id, parent, author, time and text", () => {
    const answer: ThreadReply | undefined = readReply(
      document.querySelector('[thingid="t1_mx2bb02"]') as Element,
    );
    expect(answer).toMatchObject({
      threadKey: "t3_1k9x2ab",
      replyId: "t1_mx2bb02",
      parentId: "t1_mx2bb01",
      author: "quiet_lantern_4821",
      postedAt: Date.parse("2026-10-26T15:40:00.000Z"),
    });
  });

  it("leaves the parent's quoted words out of an answer", () => {
    const answer: ThreadReply | undefined = readReply(
      document.querySelector('[thingid="t1_mx2bb02"]') as Element,
    );
    expect(answer?.text).toContain("Hardwax oil");
    expect(answer?.text).not.toContain("grain");
  });

  it("reads only the comment's own body, not its replies'", () => {
    const question: ThreadReply | undefined = readReply(itemBy("Mossy_Teapot"));
    expect(question?.text).toContain("The grain on that walnut top");
    expect(question?.text).not.toContain("Hardwax");
    expect(question?.parentId).toBeUndefined();
  });

  it("never records the post", () => {
    expect(threadReplyOf(document.querySelector("shreddit-post") as Element)).toBeUndefined();
  });

  it("asks to be read again while a comment's time or body has not been slotted in", () => {
    const comment: Element = itemBy("Deal_Scout_90210");
    comment.querySelector("faceplate-timeago")?.remove();
    expect(threadReplyOf(comment)).toBe(NOT_YET_READABLE);
    const unslotted: Element = itemBy("Quick_Fern_2291");
    unslotted.querySelector('[slot="comment"]')?.remove();
    expect(threadReplyOf(unslotted)).toBe(NOT_YET_READABLE);
  });

  it("reads Reddit's colon-less +0000 offset as UTC", () => {
    expect(readReply(itemBy("Quick_Fern_2291"))?.postedAt).toBe(Date.UTC(2026, 9, 26, 16, 5));
  });

  it("counts the copies, not the original, wherever the sort puts them", () => {
    const index = new ThreadIndex();
    for (const item of document.querySelectorAll(FEED_ITEM_SELECTOR)) {
      const reply: ThreadReply | undefined = readReply(item);
      if (reply !== undefined) {
        index.record(reply);
      }
    }
    expect(index.copiedReplyCount("mossy_teapot")).toBe(0);
    expect(index.copiedReplyCount("quick_fern_2291")).toBe(1);
    expect(index.copiedReplyCount("bright_sail_8803")).toBe(2);
    expect(index.copiedReplyCount("quiet_lantern_4821")).toBe(0);
    expect(index.copiedReplyCount("deal_scout_90210")).toBe(0);
  });
});
