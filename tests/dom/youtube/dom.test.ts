// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://www.youtube.com/watch?v=fs4k4h1v9go"}

import type { PartialSignals } from "@/src/core/types";
import type { YouTubeComment, YouTubeCommentRef } from "@/src/platforms/youtube/dom";
import type { VideoCreator } from "@/src/platforms/youtube/handles";
import {
  COMMENT_SELECTOR,
  classify,
  extractDomSignals,
  handleOfLink,
  readVideoCreator,
} from "@/src/platforms/youtube/dom";
import { RECORDED_CREATOR_HANDLE, commentMarkup, loadWatchFixture } from "./fixtures";

const commentsOf = (): YouTubeCommentRef[] =>
  [...document.querySelectorAll(COMMENT_SELECTOR)].flatMap((element) => {
    const classified: YouTubeComment = classify(element);
    return classified.status === "comment" ? [classified.post] : [];
  });

describe("classify on the recorded watch page", () => {
  beforeAll(() => loadWatchFixture());

  it("reads every comment and reply with its author's handle, lowercased", () => {
    const comments: YouTubeCommentRef[] = commentsOf();
    expect(comments).toHaveLength(60);
    expect(comments.filter((comment) => comment.isReply)).toHaveLength(20);
    expect(new Set(comments.map((comment) => comment.ref.handle)).size).toBe(56);
    expect(comments[0]?.ref).toEqual({ platform: "youtube", handle: "alice_reads61" });
    for (const comment of comments) {
      expect(comment.ref.handle).toBe(comment.ref.handle.toLowerCase());
      expect(comment.anchor.id).toBe("author-text");
      expect(comment.byCreator).toBe(false);
    }
  });

  it("names the creator from the watch metadata: its handle and its display name", () => {
    const creator: VideoCreator | undefined = readVideoCreator(document);
    expect(creator?.handles).toEqual(new Set([RECORDED_CREATOR_HANDLE]));
    expect(creator?.names).toEqual(["BBC News", RECORDED_CREATOR_HANDLE]);
  });

  it("reads nothing from a recorded comment but its handle: no avatar, no declaration here", () => {
    const signals: PartialSignals[] = commentsOf().map((comment) => extractDomSignals(comment));
    expect(signals.every((partial) => Object.keys(partial).length === 0)).toBe(true);
  });

  it("is not fooled by anything that is not a comment", () => {
    const owner: Element | null = document.querySelector("ytd-video-owner-renderer");
    expect(owner === null ? undefined : classify(owner)).toEqual({ status: "notComment" });
  });
});

describe("classify and extractDomSignals on hand-written comments", () => {
  it("anchors a creator's comment after the creator chip and marks it (GUESS markup)", () => {
    document.body.innerHTML = commentMarkup({ handle: "BBCNews", creatorChip: true });
    const [comment] = commentsOf();
    expect(comment?.byCreator).toBe(true);
    expect(comment?.ref.handle).toBe("bbcnews");
    expect(comment?.anchor.localName).toBe("ytd-author-comment-badge-renderer");
  });

  it("reads a bot handle as declared and leaves an uploaded avatar unread", () => {
    document.body.innerHTML = [
      commentMarkup({ handle: "maria_reads40", avatar: "https://yt3.ggpht.com/abc=s88-c-k" }),
      commentMarkup({ handle: "weather_bot" }),
    ].join("");
    expect(commentsOf().map((comment) => extractDomSignals(comment))).toEqual([
      {},
      { declaredAutomated: true, declaredBy: "name" },
    ]);
  });

  it("waits for an author link Polymer has not bound yet", () => {
    document.body.innerHTML = commentMarkup({}).replace(/ href="\/@maria_reads40"/, "");
    const element: Element | null = document.querySelector(COMMENT_SELECTOR);
    expect(element === null ? undefined : classify(element)).toEqual({
      status: "unreadableAuthor",
    });
  });

  it("decodes a handle in another script from its link", () => {
    const link: Element = document.createElement("a");
    link.setAttribute("href", `/@${encodeURIComponent("Ασσουρμπανιπάλ-ψ9χ")}`);
    expect(handleOfLink(link)).toBe("ασσουρμπανιπάλ-ψ9χ");
    link.setAttribute("href", "/channel/UCw7ictt1i8xu9166kl9l7ui");
    expect(handleOfLink(link)).toBeUndefined();
  });
});
