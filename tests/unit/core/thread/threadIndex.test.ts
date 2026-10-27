import type { ThreadReply } from "@/src/core/thread/threadIndex";
import { MAX_INDEXED_REPLIES, ThreadIndex } from "@/src/core/thread/threadIndex";

const TEMPLATE = "This is exactly the kind of leadership our country needs right now, well said!";
const SWAPPED = "This is exactly the kind of leadership our nation needs right now, well said!";
const ORIGINAL_THOUGHT =
  "I tried the hardwax oil on walnut last spring and it yellowed within weeks.";

let sequence = 0;

function reply(
  author: string,
  postedAt: number,
  overrides: Partial<ThreadReply> = {},
): ThreadReply {
  sequence += 1;
  return {
    threadKey: "thread-1",
    replyId: `reply-${sequence}`,
    author,
    text: TEMPLATE,
    postedAt,
    ...overrides,
  };
}

describe("ThreadIndex", () => {
  it("counts other authors whose earlier reply is a near copy", () => {
    const index = new ThreadIndex();
    index.record(reply("first", 1));
    index.record(reply("second", 2, { text: SWAPPED }));
    index.record(reply("third", 3));
    expect(index.copiedReplyCount("first")).toBe(0);
    expect(index.copiedReplyCount("second")).toBe(1);
    expect(index.copiedReplyCount("third")).toBe(2);
  });

  it("never flags the earliest author, whatever order the replies are recorded in", () => {
    const index = new ThreadIndex();
    index.record(reply("copier", 20));
    index.record(reply("original", 10));
    expect(index.copiedReplyCount("original")).toBe(0);
    expect(index.copiedReplyCount("copier")).toBe(1);
  });

  it("does not count a reply at the same time as a source", () => {
    const index = new ThreadIndex();
    index.record(reply("left", 5));
    index.record(reply("right", 5));
    expect(index.copiedReplyCount("left")).toBe(0);
    expect(index.copiedReplyCount("right")).toBe(0);
  });

  it("counts one author's repeated replies once", () => {
    const index = new ThreadIndex();
    index.record(reply("repeater", 1));
    index.record(reply("repeater", 2));
    index.record(reply("copier", 3));
    expect(index.copiedReplyCount("copier")).toBe(1);
    expect(index.copiedReplyCount("repeater")).toBe(0);
  });

  it("does not compare replies in different threads", () => {
    const index = new ThreadIndex();
    index.record(reply("first", 1, { threadKey: "thread-a" }));
    index.record(reply("second", 2, { threadKey: "thread-b" }));
    expect(index.copiedReplyCount("second")).toBe(0);
  });

  it("does not treat quoting the parent reply as copying it", () => {
    const index = new ThreadIndex();
    index.record(reply("parent", 1, { replyId: "p1" }));
    index.record(reply("child", 2, { parentId: "p1" }));
    expect(index.copiedReplyCount("child")).toBe(0);
  });

  it("does not count different replies", () => {
    const index = new ThreadIndex();
    index.record(reply("first", 1));
    index.record(reply("second", 2, { text: ORIGINAL_THOUGHT }));
    expect(index.copiedReplyCount("second")).toBe(0);
  });

  it("takes the account's most copied reply", () => {
    const index = new ThreadIndex();
    index.record(reply("a", 1));
    index.record(reply("b", 2));
    index.record(reply("copier", 3, { text: ORIGINAL_THOUGHT }));
    index.record(reply("copier", 4));
    expect(index.copiedReplyCount("copier")).toBe(2);
  });

  it("has no count for an author with no reply long enough to compare", () => {
    const index = new ThreadIndex();
    index.record(reply("brief", 1, { text: "Well said!" }));
    expect(index.copiedReplyCount("brief")).toBeUndefined();
    expect(index.copiedReplyCount("absent")).toBeUndefined();
    expect(index.size).toBe(0);
  });

  it("records a re-rendered reply once", () => {
    const index = new ThreadIndex();
    const first: ThreadReply = reply("first", 1);
    index.record(first);
    index.record({ ...first });
    index.record(reply("copier", 2));
    expect(index.size).toBe(2);
    expect(index.copiedReplyCount("copier")).toBe(1);
  });

  it("tells listeners when an earlier source arrives after the copier was scored", () => {
    const index = new ThreadIndex();
    const heard: string[][] = [];
    index.subscribe((authors) => heard.push([...authors]));
    index.record(reply("copier", 20));
    expect(index.copiedReplyCount("copier")).toBe(0);
    index.record(reply("original", 10));
    expect(heard).toEqual([["copier"]]);
    expect(index.copiedReplyCount("copier")).toBe(1);
  });

  it("tells listeners when an author scored with no comparable reply posts a copy", () => {
    const index = new ThreadIndex();
    const heard: string[][] = [];
    index.subscribe((authors) => heard.push([...authors]));
    index.record(reply("original", 1));
    index.record(reply("copier", 2, { text: "Well said!" }));
    expect(index.copiedReplyCount("copier")).toBeUndefined();
    index.record(reply("copier", 3));
    expect(heard).toEqual([["copier"]]);
    expect(index.copiedReplyCount("copier")).toBe(1);
  });

  it("tells listeners when a scored author's own new reply changes its count", () => {
    const index = new ThreadIndex();
    const heard: string[][] = [];
    index.subscribe((authors) => heard.push([...authors]));
    index.record(reply("original", 1));
    index.record(reply("copier", 2, { text: ORIGINAL_THOUGHT }));
    expect(index.copiedReplyCount("copier")).toBe(0);
    index.record(reply("copier", 3));
    expect(heard).toEqual([["copier"]]);
  });

  it("stays quiet about authors never asked about", () => {
    const index = new ThreadIndex();
    const listener = vi.fn();
    index.subscribe(listener);
    index.record(reply("original", 1));
    index.record(reply("copier", 2));
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops telling a listener that unsubscribed", () => {
    const index = new ThreadIndex();
    const listener = vi.fn();
    const unsubscribe: () => void = index.subscribe(listener);
    index.record(reply("copier", 2));
    index.copiedReplyCount("copier");
    unsubscribe();
    index.record(reply("original", 1));
    expect(listener).not.toHaveBeenCalled();
  });

  it("forgets everything on clear and tells the flagged authors", () => {
    const index = new ThreadIndex();
    const heard: string[][] = [];
    index.record(reply("original", 1));
    index.record(reply("copier", 2));
    index.copiedReplyCount("original");
    index.copiedReplyCount("copier");
    index.subscribe((authors) => heard.push([...authors]));
    index.clear();
    expect(heard).toEqual([["copier"]]);
    expect(index.size).toBe(0);
    expect(index.copiedReplyCount("copier")).toBeUndefined();
  });

  it("stops recording at the ceiling", () => {
    const index = new ThreadIndex();
    for (let position = 0; position < MAX_INDEXED_REPLIES; position += 1) {
      index.record(reply(`author-${position}`, position, { text: ORIGINAL_THOUGHT }));
    }
    index.record(reply("late", MAX_INDEXED_REPLIES));
    expect(index.size).toBe(MAX_INDEXED_REPLIES);
    expect(index.copiedReplyCount("late")).toBeUndefined();
  });
});
