import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  anonymizeSnapshot,
  anonymizeUrl,
  fakeHandleFor,
} from "../../../src/core/snapshot/anonymize";
import { youTubeHandles } from "../../../src/core/snapshot/youTube";

const GREEK_HANDLE = "Ασσουρμπανιπάλ-ψ9χ";

const page = `
  <ytd-video-owner-renderer><a href="/@BBCNews"><img src="https://yt3.ggpht.com/v4JamQ9B-PUiJHjmZQs9UwTaoLQW8vijJMMpV5QvA2wHQ6iwWM8Q1s6O4jgTl0dtDigVWAi7SA=s48-c-k-c0x00ffffff-no-rj"></a></ytd-video-owner-renderer>
  <ytd-watch-flexy video-id="MaIFGhaKF_s"></ytd-watch-flexy>
  <ytd-comment-view-model>
    <button id="author-thumbnail-button" aria-label="@LarryH-h6q"><img src="https://yt3.ggpht.com/ytc/AIdro_lUlszFun1Vb41sTiRomG-IAe5Zi-2NkRByhx2r74Q=s88-c-k-c0x00ffffff-no-rj"></button>
    <a id="author-text" href="/@LarryH-h6q"><span> @LarryH-h6q </span></a>
    <a href="/watch?v=MaIFGhaKF_s&amp;lc=Ugw-udmpRPpm7eWDaiJ4AaABAg">1 hour ago</a>
    <span id="content-text">Agree with <a href="/channel/UCsK9xWRDlBucpXBkL9pHaww">@bagowind</a>. news is news, @bagowind.</span>
  </ytd-comment-view-model>
  <ytd-comment-view-model is-reply="">
    <a id="author-text" href="/@%CE%91%CF%83%CF%83%CE%BF%CF%85%CF%81%CE%BC%CF%80%CE%B1%CE%BD%CE%B9%CF%80%CE%AC%CE%BB-%CF%889%CF%87"><span> @${GREEK_HANDLE} </span></a>
    <a href="/watch?v=MaIFGhaKF_s&amp;lc=Ugw-udmpRPpm7eWDaiJ4AaABAg.AQ8xdFsPd2bAQ8y0">2 minutes ago</a>
    <a id="author-text" href="/@user-zk8ed4kd2b">@user-zk8ed4kd2b</a> <a href="/@Bagowind">@Bagowind</a>
  </ytd-comment-view-model>
  <div class="ytLockupViewModelHost content-id-9wMYccf7V70"><a href="https://accounts.google.com/x?next=https%253A%252F%252Fwww.youtube.com%252Fwatch%253Fv%253DMaIFGhaKF_s">sign in</a></div>
  <a href="https://www.youtube.com/redirect?event=video_description&amp;redir_token=QUlxb01IWnRI&amp;q=https%3A%2F%2Fbbc.in%2Fbbcnews">bbc.in</a>`;
const result = anonymizeSnapshot(page, "youtube");

describe("anonymizeSnapshot on YouTube markup", () => {
  it("collects handles from links, percent-encoded ones decoded, and from author buttons", () => {
    expect(youTubeHandles(page)).toEqual(
      new Set(["BBCNews", "LarryH-h6q", GREEK_HANDLE, "user-zk8ed4kd2b", "Bagowind"]),
    );
  });

  it("replaces every @handle, in any case and script, in links, labels, text and mentions", () => {
    for (const real of ["BBCNews", "LarryH-h6q", "Ασσουρμπανιπάλ", "%CE%91", "zk8ed4kd2b"]) {
      expect(result.html).not.toContain(real);
    }
    expect(result.html.toLowerCase()).not.toContain("@bagowind");
    const fake: string = fakeHandleFor("LarryH-h6q", "youtube");
    expect(result.html).toContain(`href="/@${fake}"`);
    expect(result.html).toContain(`aria-label="@${fake}"`);
    expect(result.html).toContain(`<span> @${fake} </span>`);
    expect(result.html).toContain(`>@${fakeHandleFor("Bagowind", "youtube")}</a>. news is news`);
  });

  it("keeps the shape of a handle YouTube assigned, and leaves prose alone", () => {
    expect(fakeHandleFor("LarryH-h6q", "youtube")).toMatch(/^[a-z]+_[a-z]+\d{2}-[a-z]\d[a-z]$/);
    expect(fakeHandleFor(GREEK_HANDLE, "youtube")).toMatch(/^[a-z]+_[a-z]+\d{2}-[a-z]\d[a-z]$/);
    expect(fakeHandleFor("user-zk8ed4kd2b", "youtube")).toMatch(/^user-[a-z0-9]{10}$/);
    expect(fakeHandleFor("Bagowind", "youtube")).toMatch(/^[a-z]+_[a-z]+\d{2}$/);
    expect(result.html).toContain("Agree with");
    expect(result.html).toContain("news is news");
  });

  it("replaces channel, video and comment ids, a reply keeping its thread's id", () => {
    for (const id of [
      "UCsK9xWRDlBucpXBkL9pHaww",
      "MaIFGhaKF_s",
      "9wMYccf7V70",
      "Ugw-udmpRPpm7eWD",
    ]) {
      expect(result.html).not.toContain(id);
    }
    const commentIds: string[] = [...result.html.matchAll(/lc=([\w.-]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(commentIds).toHaveLength(2);
    expect(commentIds[1]?.startsWith(`${commentIds[0]}.`)).toBe(true);
    const videoIds: Set<string> = new Set(
      [...result.html.matchAll(/(?:video-id="|v=|%253D)([\w-]{11})/g)].map(
        (match) => match[1] ?? "",
      ),
    );
    expect(videoIds.size).toBe(1);
  });

  it("hashes avatar paths but keeps the ytc/ marker, and blanks redirect tokens", () => {
    expect(result.html).toContain("https://yt3.ggpht.com/ytc/anon=s88-c-k-c0x00ffffff-no-rj");
    expect(result.html).toContain("https://yt3.ggpht.com/anon=s48-c-k-c0x00ffffff-no-rj");
    expect(result.html).toContain("redir_token=anon&amp;q=https%3A%2F%2Fbbc.in%2Fbbcnews");
  });

  it("blanks the session values an innertube body carries", () => {
    const body = `{"responseContext":{"visitorData":"CgtuRTFUQVlQQlJhVSia7ITX"},"trackingParams":"CAAQhGci","serializedShareEntity":"GhhVQ0FK","canonicalChannelUrl":"http://www.youtube.com/@janeeden919"}`;
    const anonymised: string = anonymizeSnapshot(body, "youtube").html;
    expect(JSON.parse(anonymised)).toEqual({
      responseContext: { visitorData: "anon" },
      trackingParams: "anon",
      serializedShareEntity: "anon",
      canonicalChannelUrl: `http://www.youtube.com/@${fakeHandleFor("janeeden919", "youtube")}`,
    });
  });

  it("keeps a recorded address's video, faked, and a channel path's handle, faked", () => {
    const watch: string = anonymizeUrl(
      "https://www.youtube.com/watch?v=MaIFGhaKF_s&t=3",
      "youtube",
    );
    expect(watch).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[a-z0-9]{11}$/);
    expect(watch).not.toContain("MaIFGhaKF_s");
    expect(anonymizeUrl("https://www.youtube.com/@Bagowind/about", "youtube")).toBe(
      `https://www.youtube.com/@${fakeHandleFor("Bagowind", "youtube")}/about`,
    );
  });
});

describe("the committed YouTube recordings", () => {
  const fixture = (path: string): string =>
    readFileSync(resolve(process.cwd(), "tests/fixtures/youtube", path), "utf8");
  const FAKE_HANDLE = /^(?:[a-z]+_[a-z]+\d{2}(?:-[a-z0-9]{3,5})?|user-[a-z0-9]{8,}|[a-z]+\d{8})$/;

  it("name every comment author by a fake handle", () => {
    const authors: string[] = [
      ...fixture("html/watch.html").matchAll(/id="author-text"[^>]*href="\/@([^"]+)"/g),
    ].map((match) => match[1] ?? "");
    expect(authors.length).toBeGreaterThanOrEqual(20);
    for (const author of authors) expect(author).toMatch(FAKE_HANDLE);
  });

  it("look up a commenter the watch page shows, under the same fake", () => {
    const authors: string = fixture("html/watch.html");
    const channelIds = (name: string): Set<string> =>
      new Set([...fixture(`innertube/${name}`).matchAll(/UC[\w-]{22}/g)].map((match) => match[0]));
    expect(channelIds("resolve-url.json")).toEqual(channelIds("browse-about.json"));
    expect(channelIds("about-panel-continuation.json")).toEqual(channelIds("browse-about.json"));
    for (const name of ["browse-about.json", "about-panel-continuation.json"]) {
      const handles: string[] = [...fixture(`innertube/${name}`).matchAll(/\/@([\w.-]+)/g)].map(
        (match) => match[1] ?? "",
      );
      expect(handles.length, name).toBeGreaterThan(0);
      for (const handle of handles) {
        expect(handle, name).toMatch(FAKE_HANDLE);
        expect(authors, name).toContain(`href="/@${handle}"`);
      }
    }
  });
});
