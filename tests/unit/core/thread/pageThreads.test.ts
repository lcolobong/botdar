import {
  NEAR_DUPLICATE_REPLY_FEATURE,
  SHARED_RARE_DOMAIN_FEATURE,
} from "@/src/core/scoring/featureSupport";
import { PageThreads } from "@/src/core/thread/pageThreads";
import type { ReplyReading, ThreadPostReading } from "@/src/core/thread/replyText";
import { NOT_YET_READABLE } from "@/src/core/thread/replyText";
import type { ThreadReply } from "@/src/core/thread/threadIndex";
import type { AccountSignals, Feature } from "@/src/core/types";

const TEXT = "This is exactly the kind of leadership our country needs right now, well said!";

/** Stand-ins for post elements: the reader below only looks them up by identity. */
const original = {} as Element;
const copy = {} as Element;
const notYetRendered = {} as Element;
const rootPost = {} as Element;

describe("PageThreads", () => {
  it("records each discovered reply once and answers counts for its authors", () => {
    const replies = new Map<Element, ThreadReply>([
      [original, { threadKey: "t", replyId: "1", author: "first", text: TEXT, postedAt: 1 }],
      [copy, { threadKey: "t", replyId: "2", author: "second", text: TEXT, postedAt: 2 }],
    ]);
    const reader = vi.fn((element: Element) => replies.get(element));
    const threads = new PageThreads(reader);

    threads.discovered(original);
    threads.discovered(copy);
    threads.discovered(original);

    expect(reader).toHaveBeenCalledTimes(2);
    expect(threads.copiedReplyCount("second")).toBe(1);
  });

  it("reads an element that is not a reply once, however many passes meet it", () => {
    const reader = vi.fn((): ReplyReading => undefined);
    const threads = new PageThreads(reader);
    threads.discovered(rootPost);
    threads.discovered(rootPost);
    threads.discovered(rootPost);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("reads an element again only while its markup is not readable yet", () => {
    const readings: ReplyReading[] = [
      NOT_YET_READABLE,
      { threadKey: "t", replyId: "3", author: "late", text: TEXT, postedAt: 3 },
    ];
    const reader = vi.fn((): ReplyReading => readings.shift());
    const threads = new PageThreads(reader);
    threads.discovered(notYetRendered);
    threads.discovered(notYetRendered);
    threads.discovered(notYetRendered);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(threads.copiedReplyCount("late")).toBe(0);
  });

  it("appends the page evidence to the platform's account features", () => {
    const threads = new PageThreads(() => ({
      threadKey: "t",
      replyId: "1",
      author: "someone",
      text: TEXT,
      postedAt: 1,
    }));
    threads.discovered(original);
    const accountFeature: Feature = { id: "x.accountAgeDays", value: 3, group: "age", tier: 2 };
    const signals: AccountSignals = {
      ref: { platform: "x", handle: "someone" },
      provenance: {},
      tiersDelivered: [],
      observedAt: 0,
    };
    const features: Feature[] = threads.withPageEvidence(() => [accountFeature])(signals);
    expect(features.map((feature) => feature.id)).toEqual([
      "x.accountAgeDays",
      NEAR_DUPLICATE_REPLY_FEATURE,
    ]);
    const stranger: AccountSignals = { ...signals, ref: { platform: "x", handle: "stranger" } };
    expect(threads.withPageEvidence(() => [])(stranger)).toEqual([]);
  });

  it("counts the earlier linkers of a rare domain, never the root's domain", () => {
    const rare = "https://www.example-gazette.net/story";
    const readings = new Map<Element, ThreadPostReading>([
      [rootPost, { threadKey: "t", links: ["https://rootsite.example/article"] }],
      [
        original,
        { threadKey: "t", replyId: "1", author: "first", text: "", postedAt: 1, links: [rare] },
      ],
      [
        copy,
        {
          threadKey: "t",
          replyId: "2",
          author: "second",
          text: "",
          postedAt: 2,
          links: [rare, "https://rootsite.example/other", "https://www.youtube.com/watch?v=1"],
        },
      ],
    ]);
    const threads = new PageThreads((element) => readings.get(element));
    for (const element of [copy, rootPost, original]) {
      threads.discovered(element);
    }
    expect(threads.sharedDomainCount("second")).toBe(1);
    expect(threads.sharedDomainCount("first")).toBe(0);
  });

  it("joins links recorded by post id with the reply the page shows, at the links' tier", () => {
    const threads = new PageThreads(
      (element): ThreadPostReading => ({
        threadKey: "t",
        replyId: element === original ? "1" : "2",
        author: element === original ? "first" : "second",
        text: "",
        postedAt: element === original ? 1 : 2,
      }),
      1,
    );
    threads.recordPostLinks("1", ["https://www.example-gazette.net/a"]);
    threads.discovered(original);
    threads.discovered(copy);
    threads.recordPostLinks("2", ["https://example-gazette.net/b"]);
    const signals: AccountSignals = {
      ref: { platform: "x", handle: "second" },
      provenance: {},
      tiersDelivered: [],
      observedAt: 0,
    };
    expect(
      threads
        .withPageEvidence(() => [])(signals)
        .find((f) => f.id === SHARED_RARE_DOMAIN_FEATURE),
    ).toEqual({ id: SHARED_RARE_DOMAIN_FEATURE, value: 1, group: "coordination", tier: 1 });
  });

  it("tells one listener about either index's changes, until it unsubscribes", () => {
    const readings = new Map<Element, ThreadPostReading>([
      [copy, { threadKey: "t", replyId: "2", author: "second", text: TEXT, postedAt: 2 }],
      [original, { threadKey: "t", replyId: "1", author: "first", text: TEXT, postedAt: 1 }],
    ]);
    const threads = new PageThreads((element) => readings.get(element));
    const listener = vi.fn();
    const unsubscribe: () => void = threads.subscribe(listener);
    threads.recordPostLinks("2", ["https://www.example-gazette.net/a"]);
    threads.discovered(copy);
    expect(threads.copiedReplyCount("second")).toBe(0);
    expect(threads.sharedDomainCount("second")).toBe(0);
    threads.recordPostLinks("1", ["https://www.example-gazette.net/b"]);
    threads.discovered(original);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    threads.navigated();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("forgets the page's replies on navigation and records them again after it", () => {
    const reader = vi.fn((element: Element): ThreadReply => ({
      threadKey: "t",
      replyId: element === original ? "1" : "2",
      author: element === original ? "first" : "second",
      text: TEXT,
      postedAt: element === original ? 1 : 2,
    }));
    const threads = new PageThreads(reader);
    threads.discovered(original);
    threads.discovered(copy);
    threads.navigated();
    expect(threads.copiedReplyCount("second")).toBeUndefined();
    threads.discovered(copy);
    expect(reader).toHaveBeenCalledTimes(3);
    expect(threads.copiedReplyCount("second")).toBe(0);
  });
});
