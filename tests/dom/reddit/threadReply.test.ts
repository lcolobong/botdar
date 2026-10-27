// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.reddit.com/r/woodworking/comments/1k9x2ab/finished_the_walnut_side_table/"}

import { rareDomainsOf } from "@/src/core/links/topDomains";
import type { ReplyReading, ThreadRootLinks } from "@/src/core/thread/replyText";
import { NOT_YET_READABLE } from "@/src/core/thread/replyText";
import { SharedDomainIndex } from "@/src/core/thread/sharedDomainIndex";
import type { ThreadReply } from "@/src/core/thread/threadIndex";
import { ThreadIndex, placementOf } from "@/src/core/thread/threadIndex";
import { FEED_ITEM_SELECTOR } from "@/src/platforms/reddit/dom";
import { threadReplyOf, threadRootLinksOf } from "@/src/platforms/reddit/threadReply";
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

describe("Reddit thread replies", () => {
  beforeEach(() => loadRedditFixture("copied-replies.html"));

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

  it("gives a comment without links no links field", () => {
    expect(readReply(itemBy("Mossy_Teapot"))).not.toHaveProperty("links");
  });
});

describe("Reddit thread links", () => {
  const POST_PAGE = new URL(
    "https://www.reddit.com/r/harbourcity/comments/1kb4c7d/council_votes_to_close_the_harbour_street_bridge/",
  );
  const RARE_LINK = "https://www.harbourlight-report.example/2026/10/bridge-land-deal";

  beforeEach(() => loadRedditFixture("shared-links.html"));

  /** The reading as a root; fails the test when the post was not readable yet. */
  function readRoot(element: Element): ThreadRootLinks | undefined {
    const reading: ThreadRootLinks | undefined | typeof NOT_YET_READABLE = threadRootLinksOf(
      element,
      POST_PAGE,
    );
    if (reading === NOT_YET_READABLE) {
      throw new Error("post not readable yet");
    }
    return reading;
  }

  it("reads the links in a comment's own body", () => {
    expect(readReply(itemBy("Tidal_Quill_5530"))?.links).toEqual([RARE_LINK]);
  });

  it("leaves a quoted link out of a comment's links", () => {
    const body: Element | null = itemBy("Fern_Garden").querySelector('[slot="comment"]');
    body?.insertAdjacentHTML(
      "afterbegin",
      `<blockquote><a href="${RARE_LINK}">quoted</a></blockquote>`,
    );
    expect(readReply(itemBy("Fern_Garden"))?.links).toEqual([
      "https://www.youtube.com/watch?v=h4rb0urD3t0",
    ]);
  });

  it("reads a link post's target as the root's links on its own page only", () => {
    const post: Element = document.querySelector("shreddit-post") as Element;
    expect(threadRootLinksOf(post, POST_PAGE)).toEqual({
      threadKey: "t3_1kb4c7d",
      links: ["https://www.citytribune.example/news/harbour-bridge-closure"],
    });
    expect(threadRootLinksOf(post, new URL("https://www.reddit.com/"))).toBeUndefined();
    expect(threadRootLinksOf(itemBy("Fern_Garden"), POST_PAGE)).toBeUndefined();
  });

  it("reads the links in a text post's body", () => {
    const post: Element = document.querySelector("shreddit-post") as Element;
    post.removeAttribute("content-href");
    post.insertAdjacentHTML(
      "beforeend",
      `<div slot="text-body"><p>Background: <a href="${RARE_LINK}">here</a></p></div>`,
    );
    expect(readRoot(post)?.links).toEqual([RARE_LINK]);
  });

  it("reads the post again later while neither its target nor its body is in the DOM", () => {
    const post: Element = document.querySelector("shreddit-post") as Element;
    post.removeAttribute("content-href");
    expect(threadRootLinksOf(post, POST_PAGE)).toBe(NOT_YET_READABLE);
  });

  it("counts the earlier linkers of a small site, never the post's own site", () => {
    const index = new SharedDomainIndex();
    for (const item of document.querySelectorAll(FEED_ITEM_SELECTOR)) {
      const reply: ThreadReply | undefined = readReply(item);
      const root: ThreadRootLinks | undefined = readRoot(item);
      if (reply !== undefined) {
        index.recordReply(placementOf(reply));
        index.recordPostDomains(reply.replyId, rareDomainsOf(reply.links ?? []));
      }
      if (root !== undefined) {
        index.recordRootDomains(root.threadKey, rareDomainsOf(root.links));
      }
    }
    expect(index.sharedDomainCount("amber_wren_4471")).toBe(0);
    expect(index.sharedDomainCount("brisk_moth_7180")).toBe(3);
    expect(index.sharedDomainCount("tidal_quill_5530")).toBe(5);
    expect(index.sharedDomainCount("rusty_kettle")).toBeUndefined();
    expect(index.sharedDomainCount("fern_garden")).toBeUndefined();
  });
});
