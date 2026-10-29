import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  anonymizeSnapshot,
  anonymizeUrl,
  fakeHandleFor,
} from "../../../src/core/snapshot/anonymize";
import {
  distinctDigits,
  distinctFakes,
  fakeHandle,
  fakeId,
} from "../../../src/core/snapshot/fakeNames";
import { handlesOf } from "../../../src/core/snapshot/accountHandles";
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

describe("handlesOf", () => {
  // Reddit, X and Bluesky handles are ASCII, so their readers never capture an emoji; the rule they
  // share with YouTube's reader still counts characters, and two are too few.
  it("skips a two-character name and keeps a three-character one", () => {
    expect(handlesOf('<a href="/user/ab/">ab</a>', "reddit")).toEqual(new Set());
    expect(handlesOf('<a href="/user/abc/">abc</a>', "reddit")).toEqual(new Set(["abc"]));
    expect(handlesOf('<a href="/user/\u{1F600}\u{1F600}/">x</a>', "reddit")).toEqual(new Set());
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

  it("gives X status ids that differ in one place distinct numeric fakes, the same id the same fake", () => {
    const html = `<a href="/a/status/1234567890123456781">1</a><a href="/a/status/1234567890123456782">2</a>
      <a href="/a/status/1234567890123456781">3</a>`;
    const fakeIds: string[] = [
      ...anonymizeSnapshot(html, "x").html.matchAll(/status\/(\d+)"/g),
    ].map((match) => match[1] ?? "");
    expect(fakeIds).toHaveLength(3);
    expect(fakeIds.every((fakeId) => /^\d{19}$/.test(fakeId))).toBe(true);
    expect(fakeIds[0]).not.toBe(fakeIds[1]);
    expect(fakeIds[0]).toBe(fakeIds[2]);
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

describe("anonymizeSnapshot on Hacker News markup", () => {
  const html = `<tr class="athing comtr" id="50248190"><td><span class="comhead"><a href="user?id=torben-friis" class="hnuser">torben-friis</a>
      <a id='up_50248190' href='vote?id=50248190&amp;how=up&amp;goto=item%3Fid%3D50245138'></a>
      <span id="unv_50248190"></span><a href="#50249391" class="clicky">next</a>
      <a href="user?id=_1" class="hnuser">_1</a> <a href="user?id=newcomer" class="hnuser"><font color="#3c963c">newcomer</font></a>
      <a href="reply?id=50248190&amp;goto=item%3Fid%3D50245138%2350248190">reply</a></span>
      <input type="hidden" name="parent" value="50245138"><input type="hidden" name="hmac" value="4db0af3cee0e586e981da4b94108e0a01d537b8a">
      <div class="commtext">torben-friis is right, and 12345 is not an id.</div></td></tr>`;
  const result = anonymizeSnapshot(html, "hackernews");

  it("replaces usernames in profile links and hnuser text, two-character and green ones too", () => {
    for (const handle of ['id=torben-friis"', ">torben-friis<", "user?id=_1", ">_1<", "newcomer"]) {
      expect(result.html).not.toContain(handle);
    }
    const fake: string = fakeHandleFor("torben-friis", "hackernews");
    expect(result.html).toContain(`href="user?id=${fake}" class="hnuser">${fake}</a>`);
    // Comment text is prose, left alone as on every platform.
    expect(result.html).toContain("torben-friis is right");
  });

  it("leaves closing tags alone for an author named after one, such as div", () => {
    const page = `<div class="comment"><span class="comhead"><a href="user?id=div" class="hnuser">div</a></span>
      <a href="https://github.com/div/tools">repo</a></div></td></tr></table>`;
    const anonymised: string = anonymizeSnapshot(page, "hackernews").html;
    const fake: string = fakeHandleFor("div", "hackernews");
    expect(anonymised).toContain(`<a href="user?id=${fake}" class="hnuser">${fake}</a></span>`);
    expect(anonymised).toContain(`https://github.com/${fake}/tools`);
    expect(anonymised).toContain('<div class="comment">');
    expect(anonymised).toContain("</a></div></td></tr></table>");
  });

  it("keeps an all-digit colour but replaces item fragments", () => {
    const page = `<font color="#828282">a</font><span style="color:#828282">b</span>
      <a href="#12345678">next</a><a href="item?id=1#12345678">context</a>`;
    const anonymised: string = anonymizeSnapshot(page, "hackernews").html;
    expect(anonymised).toContain('<font color="#828282">');
    expect(anonymised).toContain('style="color:#828282"');
    expect(anonymised).not.toContain("12345678");
    expect(anonymised).toMatch(/href="#\d{8}">next/);
    expect(anonymised).toMatch(/item\?id=1#\d{8}"/);
  });

  it("never rewrites markup or prose for a two-letter user such as td", () => {
    const page = `<table><tr class="athing"><td class="default"><span class="comhead"><a href="user?id=td" class="hnuser">td</a> by</span>
      <div class="commtext">td and by stay words here.</div></td></tr></table>`;
    const anonymised: string = anonymizeSnapshot(page, "hackernews").html;
    const fake: string = fakeHandleFor("td", "hackernews");
    expect(anonymised).toContain(`<a href="user?id=${fake}" class="hnuser">${fake}</a> by</span>`);
    expect(anonymised).toContain('<table><tr class="athing"><td class="default">');
    expect(anonymised).toContain("</td></tr></table>");
    expect(anonymised).toContain("td and by stay words here.");
  });

  it("keeps two accounts whose names differ only in case apart", () => {
    const page = `<a href="user?id=Foo" class="hnuser">Foo</a><a href="user?id=foo" class="hnuser">foo</a>`;
    const fakes: string[] = [
      ...anonymizeSnapshot(page, "hackernews").html.matchAll(/class="hnuser">([^<]+)</g),
    ].map((match) => match[1] ?? "");
    expect(fakes).toHaveLength(2);
    expect(new Set(fakes).size).toBe(2);
    expect(fakes).not.toContain("Foo");
    expect(fakes).not.toContain("foo");
  });

  it("anonymises the user page's title and birth link and a site named after its author", () => {
    const page = `<title>Profile: catfood | Hacker News</title><a href="front?day=2013-11-05&amp;birth=catfood">x</a>
      <a href="user?id=catfood" class="hnuser">catfood</a><span class="sitebit comhead"><a href="from?site=catfood.com"><span class="sitestr">catfood.com</span></a></span>
      <div class="commtext"><a href="https://github.com/catfood/kan">https://github.com/catfood/kan</a></div></td>`;
    const anonymised: string = anonymizeSnapshot(page, "hackernews").html;
    expect(anonymised).not.toContain("catfood");
  });

  it("replaces item ids everywhere they appear, consistently, and blanks the form hmac", () => {
    for (const id of ["50248190", "50245138", "50249391", "4db0af3cee"]) {
      expect(result.html).not.toContain(id);
    }
    const rowIds: string[] = [...result.html.matchAll(/ id="(\d{8})"/g)].map(
      (match) => match[1] ?? "",
    );
    expect(rowIds).toHaveLength(1);
    const rowId: string = rowIds[0] ?? "";
    expect(result.html).toContain(`id='up_${rowId}'`);
    expect(result.html).toContain(`vote?id=${rowId}&amp;`);
    expect(result.html).toContain(`%23${rowId}"`);
    expect(result.html).toContain("12345 is not an id");
    expect(result.html).toContain(`name="hmac" value="${"0".repeat(40)}"`);
  });

  it("gives distinct ids distinct fakes, which base-36 letters turned into sevens did not", () => {
    const fakeNumeric: (id: string) => string = distinctDigits();
    const ids: string[] = Array.from({ length: 5000 }, (_unused, index) =>
      String(50_240_000 + index),
    );
    const fakes: string[] = ids.map(fakeNumeric);
    expect(new Set(fakes).size).toBe(ids.length);
    expect(fakes.every((fake) => /^\d{8}$/.test(fake))).toBe(true);
    expect(fakeNumeric(ids[0] ?? "")).toBe(fakes[0]);
  });

  it("moves a colliding handle to its next fake and leaves the others as they are", () => {
    const sameFake = (): string => "alice_sails57";
    const fakes: Map<string, string> = distinctFakes(
      ["siva7", "torben-friis", "Siva7"],
      (handle, attempt) => (attempt === 0 ? sameFake() : `${handle}-${attempt}`),
      (handle) => handle.toLowerCase(),
    );
    expect(fakes.get("Siva7")).toBe("alice_sails57");
    expect(fakes.get("siva7")).toBe("alice_sails57");
    expect(fakes.get("torben-friis")).toBe("torben-friis-1");
  });

  it("keeps the id query of a recorded address, anonymised", () => {
    expect(anonymizeUrl("https://news.ycombinator.com/user?id=torben-friis", "hackernews")).toBe(
      `https://news.ycombinator.com/user?id=${fakeHandleFor("torben-friis", "hackernews")}`,
    );
    const item: string = anonymizeUrl(
      "https://news.ycombinator.com/item?id=50245138",
      "hackernews",
    );
    expect(item).toMatch(/^https:\/\/news\.ycombinator\.com\/item\?id=\d{8}$/);
    expect(item).not.toContain("50245138");
    expect(anonymizeUrl("https://news.ycombinator.com/newcomments", "hackernews")).toBe(
      "https://news.ycombinator.com/newcomments",
    );
  });
});

describe("the committed Hacker News recordings", () => {
  it("give every story and comment row its own fake id", () => {
    for (const name of ["front", "newest", "thread", "newcomments"]) {
      const html: string = readFileSync(
        resolve(process.cwd(), "tests/fixtures/hackernews/html", `${name}.html`),
        "utf8",
      );
      const rowIds: string[] = [...html.matchAll(/<tr class="athing[^"]*" id="(\d+)"/g)].map(
        (match) => match[1] ?? "",
      );
      expect(rowIds.length, name).toBeGreaterThan(0);
      expect(new Set(rowIds).size, name).toBe(rowIds.length);
    }
  });
});
