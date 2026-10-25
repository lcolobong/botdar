import { describe, expect, it } from "vitest";

import {
  anonymizeSnapshot,
  anonymizeUrl,
  fakeHandleFor,
} from "../../../src/core/snapshot/anonymize";
import { fakeHandle, fakeId } from "../../../src/core/snapshot/fakeNames";
import { isDefaultAvatarUrl } from "../../../src/platforms/reddit/conventions";

describe("fakeHandle", () => {
  it("is stable, case-insensitive on the input, and keeps the shape the features read", () => {
    expect(fakeHandle("Den_Hviide", "plain")).toBe(fakeHandle("den_hviide", "plain"));
    expect(fakeHandle("Den_Hviide", "generated")).toMatch(/^[A-Z][a-z]+_[A-Z][a-z]+_\d{4}$/);
    expect(fakeHandle("Den_Hviide", "nameDigits")).toMatch(/^[a-z]+\d{8}$/);
    expect(fakeHandle("Den_Hviide", "plain")).toMatch(/^[a-z]+_[a-z]+\d{2}$/);
    expect(fakeId("19rn2qfj5vdcy")).toHaveLength(13);
    expect(fakeId("19rn2qfj5vdcy")).not.toBe("19rn2qfj5vdcy");
  });
});

describe("anonymizeSnapshot on Reddit markup", () => {
  const html = `
    <shreddit-post author="Real_Person" id="t3_1xf6xqz" permalink="/r/politics/comments/1xf6xqz/title/">
      <a href="https://www.reddit.com/user/Real_Person/" aria-label="Real_Person's profile">u/Real_Person</a>
      <img src="https://styles.redditmedia.com/t5_abc/styles/profileIcon_klqlly9fc4l41.png?width=64&amp;s=4cd0" alt="u/Real_Person avatar">
    </shreddit-post>
    <shreddit-comment author="AutoModerator" thingid="t1_19rn2qfj5vdcy" postid="t3_1xf6xqz">
      <a href="https://www.reddit.com/user/AutoModerator/">AutoModerator</a>
      <img src="https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png">
    </shreddit-comment>
    <shreddit-comment author="Brisk_Comet_0042"><a href="/user/Brisk_Comet_0042/">Brisk_Comet_0042</a></shreddit-comment>`;
  const result = anonymizeSnapshot(html, "reddit");

  it("replaces every occurrence of a username, including labels and alt text", () => {
    expect(result.html).not.toContain("Real_Person");
    const fake: string = fakeHandleFor("Real_Person", "reddit");
    expect(result.html).toContain(`author="${fake}"`);
    expect(result.html).toContain(`/user/${fake}/`);
    expect(result.html).toContain(`aria-label="${fake}'s profile"`);
    expect(result.html).toContain(`alt="u/${fake} avatar"`);
  });

  it("keeps system accounts and the generated shape of a generated name", () => {
    expect(result.html).toContain('author="AutoModerator"');
    expect(result.html).not.toContain("Brisk_Comet_0042");
    expect(result.html).toMatch(/author="[A-Z][a-z]+_[A-Z][a-z]+_\d{4}"/);
  });

  it("replaces thing ids and permalink ids consistently", () => {
    expect(result.html).not.toContain("1xf6xqz");
    expect(result.html).not.toContain("19rn2qfj5vdcy");
    const fakeThing: string = `t3_${fakeId("1xf6xqz")}`;
    expect(result.html).toContain(`id="${fakeThing}"`);
    expect(result.html).toContain(`postid="${fakeThing}"`);
  });

  it("hashes an uploaded avatar but leaves the stock avatar recognisable", () => {
    expect(result.html).not.toContain("profileIcon_klqlly9fc4l41");
    const snoovatar: string = anonymizeSnapshot(
      '<img src="https://styles.redditmedia.com/t5_1203y/styles/profileIcon_snoo0323b2da-408d-4559-add0-5e3c30d2a6db-headshot-f.png">',
      "reddit",
    ).html;
    expect(snoovatar).toContain("profileIcon_anon.png");
    expect(snoovatar).not.toContain("0323b2da");
    expect(result.html).toContain("profileIcon_anon.png");
    expect(result.html).not.toContain("?width=64");
    expect(
      isDefaultAvatarUrl("https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png"),
    ).toBe(true);
    expect(result.html).toContain("avatars/defaults/v2/avatar_default_3.png");
    expect(result.handles).toBeGreaterThanOrEqual(4);
    expect(result.replaced).toBeGreaterThan(result.handles);
  });
});

describe("anonymizeUrl", () => {
  it("replaces the account in profile and status addresses and drops the query", () => {
    expect(anonymizeUrl("https://x.com/realuser/status/1234567890123456789?s=20", "x")).toMatch(
      new RegExp(`^https://x\\.com/${fakeHandleFor("realuser", "x")}/status/\\d{19}$`),
    );
    expect(anonymizeUrl("https://x.com/realuser/status/1234567890123456789", "x")).not.toContain(
      "1234567890123456789",
    );
    expect(
      anonymizeUrl("https://www.reddit.com/r/politics/comments/1xf6xqz/title/", "reddit"),
    ).not.toContain("1xf6xqz");
    expect(anonymizeUrl("https://x.com/home", "x")).toBe("https://x.com/home");
    expect(anonymizeUrl("https://www.reddit.com/user/foo", "reddit")).toBe(
      `https://www.reddit.com/user/${fakeHandleFor("foo", "reddit")}`,
    );
    expect(anonymizeUrl("https://www.reddit.com/r/politics/", "reddit")).toBe(
      "https://www.reddit.com/r/politics/",
    );
    expect(anonymizeUrl("https://bsky.app/profile/alice.bsky.social/post/3kabc", "bluesky")).toBe(
      `https://bsky.app/profile/${fakeHandleFor("alice.bsky.social", "bluesky")}/post/3kabc`,
    );
    expect(
      anonymizeUrl("https://bsky.app/profile/did:plc:abcdefghijklmnopqrstuvwx", "bluesky"),
    ).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(anonymizeUrl("not a url", "x")).toBe("not a url");
  });
});

describe("anonymizeSnapshot on X and Bluesky markup", () => {
  it("replaces X handles from status links and mentions, keeping a name-plus-digits shape", () => {
    const html = `<a href="/jane_doe/status/1234567890123456789">@jane_doe</a> <a href="/home">Home</a>
      <a href="/bob12345678/status/1234567890123456789">@bob12345678</a>
      <img src="https://pbs.twimg.com/profile_images/1234/abc_x96.jpg"><img src="https://abs.twimg.com/sticky/default_profile_images/default_profile_x96.png">`;
    const result = anonymizeSnapshot(html, "x");
    expect(result.html).not.toContain("jane_doe");
    expect(result.html).not.toContain("1234567890123456789");
    expect(result.html).toContain('href="/home"');
    expect(result.html).toMatch(/href="\/[a-z]+\d{8}\/status\/\d{19}"/);
    expect(result.html).toContain("/profile_images/0/anon_normal.jpg");
    expect(result.html).toContain("default_profile_images/default_profile_x96.png");
  });

  it("replaces Bluesky handles and DIDs, keeping bsky.social apart from custom domains", () => {
    const html = `<div data-testid="feedItem-by-jane.bsky.social"><a href="/profile/jane.bsky.social">@jane.bsky.social</a></div>
      <a href="/profile/did:plc:abcdefghijklmnopqrstuvwx/post/3kabcdefghij2">x</a>
      <a href="/profile/news.example.org">@news.example.org</a>
      <img src="https://cdn.bsky.app/img/avatar/plain/did:plc:abcdefghijklmnopqrstuvwx/bafy@jpeg">`;
    const result = anonymizeSnapshot(html, "bluesky");
    expect(result.html).not.toContain("jane.bsky.social");
    expect(result.html).toMatch(/data-testid="feedItem-by-[a-z]+\d{2}\.bsky\.social"/);
    expect(result.html).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(result.html).not.toContain("news.example.org");
    expect(result.html).toMatch(/href="\/profile\/[a-z]+\d{2}\.bsky\.social"/);
    expect(result.html).toMatch(/href="\/profile\/[a-z]+\d{2}\.example\.com"/);
    expect(result.html).toContain("/img/avatar/plain/anon@jpeg");
  });
});
