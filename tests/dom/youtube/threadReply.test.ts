// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.youtube.com/watch?v=fs4k4h1v9go"}

import { NOT_YET_READABLE } from "@/src/core/thread/replyText";
import type { ReplyReading } from "@/src/core/thread/replyText";
import type { ThreadReply } from "@/src/core/thread/threadIndex";
import { COMMENT_SELECTOR } from "@/src/platforms/youtube/dom";
import {
  ThreadOrdinals,
  relativeAgeMillis,
  threadKeyOf,
  threadReplyOf,
  threadRootLinksOf,
} from "@/src/platforms/youtube/threadReply";
import { RECORDED_VIDEO_ID, RECORDED_WATCH_URL, commentMarkup, loadWatchFixture } from "./fixtures";

const PAGE_URL = new URL(RECORDED_WATCH_URL);
const REFERENCE_TIME = Date.UTC(2026, 9, 27, 23, 40, 0);
const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Reads every comment on the page at `readAt`, with a fresh thread order, as one discovery pass. */
const readAll = (readAt: number = REFERENCE_TIME): ReplyReading[] => {
  const ordinals = new ThreadOrdinals();
  return [...document.querySelectorAll(COMMENT_SELECTOR)].map((element) =>
    threadReplyOf(element, PAGE_URL, ordinals, undefined, readAt),
  );
};

const isReply = (reading: ReplyReading): reading is ThreadReply =>
  typeof reading === "object" && reading !== null;

describe("threadReplyOf on the recorded watch page", () => {
  beforeAll(() => loadWatchFixture());

  it("reads every comment as a reply in the video's thread, each with its own id", () => {
    const replies: ThreadReply[] = readAll().filter(isReply);
    expect(replies).toHaveLength(60);
    expect(new Set(replies.map((reply) => reply.replyId)).size).toBe(60);
    expect(replies.every((reply) => reply.threadKey === RECORDED_VIDEO_ID)).toBe(true);
    expect(replies.every((reply) => reply.text.trim().length > 0)).toBe(true);
  });

  it("gives a reply its thread's top-level comment as parent, and a top-level comment none", () => {
    const replies: ThreadReply[] = readAll().filter(isReply);
    const withParent: ThreadReply[] = replies.filter((reply) => reply.parentId !== undefined);
    expect(withParent).toHaveLength(20);
    const ids: Set<string> = new Set(replies.map((reply) => reply.replyId));
    for (const reply of withParent) {
      expect(ids.has(reply.parentId ?? "")).toBe(true);
      expect(reply.replyId.startsWith(`${reply.parentId}.`)).toBe(true);
    }
  });

  it("dates every recorded reply after its thread's top comment", () => {
    const replies: ThreadReply[] = readAll().filter(isReply);
    for (const reply of replies.filter((candidate) => candidate.parentId !== undefined)) {
      const parent: ThreadReply | undefined = replies.find(
        (candidate) => candidate.replyId === reply.parentId,
      );
      expect(parent).toBeDefined();
      expect(reply.postedAt).toBeGreaterThan(parent?.postedAt ?? Infinity);
    }
  });

  it("reads the description's outbound links, unwrapped, as the thread root's", () => {
    expect(threadRootLinksOf(document, PAGE_URL)).toEqual({
      threadKey: RECORDED_VIDEO_ID,
      links: [
        "https://www.tiktok.com/@bbcnews",
        "http://instagram.com/bbcnews",
        "http://www.facebook.com/bbcnews",
        "https://twitter.com/BBCWorld",
      ],
    });
  });
});

describe("threadReplyOf on hand-written comments", () => {
  it("reads a comment's outbound link through YouTube's redirect and skips links within YouTube", () => {
    document.body.innerHTML = commentMarkup({
      text: `See <a href="https://www.youtube.com/redirect?event=comments&amp;q=https%3A%2F%2Fsmall-site.example%2Fx">small-site.example</a>, <a href="/watch?v=${RECORDED_VIDEO_ID}&amp;t=30s">0:30</a> and <a href="/channel/UCw7ictt1i8xu9166kl9l7ui">@someone</a> for more about this.`,
    });
    const [reading] = readAll();
    expect(isReply(reading) ? reading.links : undefined).toEqual(["https://small-site.example/x"]);
  });

  it("dates a comment from its relative age, edited or not, and breaks ties by thread order", () => {
    document.body.innerHTML = `<ytd-comment-thread-renderer>${commentMarkup({
      commentId: "UgwHandWrittenTop00000000AaABAg",
      age: "2 hours ago",
    })}<ytd-comment-thread-renderer is-sub-thread="">${commentMarkup({
      commentId: "UgwHandWrittenTop00000000AaABAg.AQ8xdF",
      age: "2 hours ago (edited)",
      reply: true,
    })}</ytd-comment-thread-renderer></ytd-comment-thread-renderer>`;
    const [top, reply] = readAll().filter(isReply);
    expect(top?.postedAt).toBe(REFERENCE_TIME - 2 * HOUR);
    expect(reply?.postedAt).toBe(REFERENCE_TIME - 2 * HOUR + 1);
    expect(reply?.parentId).toBe("UgwHandWrittenTop00000000AaABAg");
  });

  it("waits for a comment Polymer has not bound, and skips one whose age it cannot read", () => {
    document.body.innerHTML =
      commentMarkup({}).replace(/ href="\/@maria_reads40"/, "") +
      commentMarkup({ age: "il y a 2 heures" });
    expect(readAll()).toEqual([NOT_YET_READABLE, undefined]);
  });

  it("reads nothing off a watch page", () => {
    document.body.innerHTML = commentMarkup({});
    const element: Element | null = document.querySelector(COMMENT_SELECTOR);
    const channelPage = new URL("https://www.youtube.com/@maria_reads40/community");
    expect(threadKeyOf(channelPage)).toBeUndefined();
    expect(
      element === null ? null : threadReplyOf(element, channelPage, new ThreadOrdinals()),
    ).toBe(undefined);
  });

  it("dates a comment from when it is read, so one loaded twenty minutes later is not dated earlier", () => {
    const ordinals = new ThreadOrdinals();
    document.body.innerHTML = commentMarkup({
      commentId: "UgwFirstLoaded0000000000AaABAg",
      age: "5 minutes ago",
    });
    const first: Element | null = document.querySelector(COMMENT_SELECTOR);
    const early: ReplyReading =
      first === null
        ? undefined
        : threadReplyOf(first, PAGE_URL, ordinals, undefined, REFERENCE_TIME);
    document.body.innerHTML = commentMarkup({
      commentId: "UgwLoadedLater00000000000AaABAg",
      age: "5 minutes ago",
    });
    const later: Element | null = document.querySelector(COMMENT_SELECTOR);
    const late: ReplyReading =
      later === null
        ? undefined
        : threadReplyOf(later, PAGE_URL, ordinals, undefined, REFERENCE_TIME + 20 * MINUTE);
    expect(isReply(early) && isReply(late) && late.postedAt - early.postedAt).toBe(20 * MINUTE);
  });

  it("counts a thread's order once per comment, however often a comment is read", () => {
    document.body.innerHTML = `<ytd-comment-thread-renderer>${commentMarkup({
      commentId: "UgwHandWrittenTop00000000AaABAg",
    })}<ytd-comment-thread-renderer is-sub-thread="">${commentMarkup({
      commentId: "UgwHandWrittenTop00000000AaABAg.AQ8xdF",
      reply: true,
    })}</ytd-comment-thread-renderer></ytd-comment-thread-renderer>`;
    const ordinals = new ThreadOrdinals();
    const [top, reply] = [...document.querySelectorAll(COMMENT_SELECTOR)];
    if (top === undefined || reply === undefined)
      throw new Error("hand-written thread did not parse");
    expect([ordinals.ordinalOf(top), ordinals.ordinalOf(reply), ordinals.ordinalOf(top)]).toEqual([
      0, 1, 0,
    ]);
  });
});

describe("relativeAgeMillis", () => {
  it("reads the spans YouTube writes, in English", () => {
    expect(relativeAgeMillis("51 seconds ago")).toBe(51_000);
    expect(relativeAgeMillis("1 minute ago")).toBe(60_000);
    expect(relativeAgeMillis(" 3 hours ago (edited) ")).toBe(3 * HOUR);
    expect(relativeAgeMillis("2 weeks ago")).toBe(14 * 24 * HOUR);
    expect(relativeAgeMillis("Premiered 3 hours ago")).toBeUndefined();
  });
});
