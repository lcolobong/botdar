import { readFileSync } from "node:fs";

import type { ChannelAboutParseResult } from "@/src/platforms/youtube/parsers/channelAbout";
import {
  countFromText,
  findAboutViewModel,
  joinedDateMillis,
  parseChannelAbout,
  parseResolveUrl,
} from "@/src/platforms/youtube/parsers/channelAbout";

const recorded = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/youtube/innertube/${name}`, import.meta.url), "utf8"),
  );

const CHANNEL_ID = "UCw7ictt1i8xu9166kl9l7ui";
const JOINED: number = Date.UTC(2013, 9, 15);
const DAY_MILLIS = 86_400_000;

/** A browse body as small as the parser accepts, with the panel's fields replaced. */
function aboutBody(about: Record<string, unknown>, channel?: Record<string, unknown>): unknown {
  return {
    ...(channel === undefined ? {} : { metadata: { channelMetadataRenderer: channel } }),
    onResponseReceivedEndpoints: [
      {
        appendContinuationItemsAction: {
          continuationItems: [
            {
              aboutChannelRenderer: {
                metadata: { aboutChannelViewModel: { channelId: CHANNEL_ID, ...about } },
              },
            },
          ],
        },
      },
    ],
  };
}

describe("the recorded innertube bodies", () => {
  it("resolve an About address to the channel id and the About tab's params", () => {
    expect(parseResolveUrl(recorded("resolve-url.json"))).toEqual({
      browseId: CHANNEL_ID,
      params: "EgVhYm91dLgBAJIDAPIGBgoCMgBKAA%3D%3D",
    });
  });

  it("read the join date, counts, title and an empty description from the browse", () => {
    expect(parseChannelAbout(recorded("browse-about.json"))).toEqual({
      status: "ok",
      channelId: CHANNEL_ID,
      signals: { createdAt: JOINED, postCount: 4, followers: 3, bio: "", displayName: "Wally" },
    });
  });

  // The page's own request carried the session's cookies (PREF tz=America.New_York) and dated the
  // join a day later than the cookieless route; the day is the only difference.
  it("read the same facts from the continuation the page sends, which has no title", () => {
    const result: ChannelAboutParseResult = parseChannelAbout(
      recorded("about-panel-continuation.json"),
    );
    expect(result).toEqual({
      status: "ok",
      channelId: CHANNEL_ID,
      signals: { createdAt: JOINED + DAY_MILLIS, postCount: 4, followers: 3, bio: "" },
    });
  });
});

describe("parseChannelAbout on untrusted bodies", () => {
  it("answers unavailable for anything without an About panel and a channel id", () => {
    for (const body of [null, undefined, "x", 42, [], {}, aboutBody({ channelId: 7 })]) {
      expect(parseChannelAbout(body)).toEqual({ status: "unavailable" });
    }
    expect(parseChannelAbout(aboutBody({ channelId: "UC-short" }))).toEqual({
      status: "unavailable",
    });
  });

  it("reads a panel with no video count as no public videos, and leaves a hidden subscriber count out", () => {
    expect(
      parseChannelAbout(aboutBody({ joinedDateText: { content: "Joined Jul 12, 2026" } })),
    ).toEqual({
      status: "ok",
      channelId: CHANNEL_ID,
      signals: { createdAt: Date.UTC(2026, 6, 12), postCount: 0, bio: "" },
    });
  });

  it("reads a country and a description that declares automation, and never the avatar", () => {
    const result: ChannelAboutParseResult = parseChannelAbout(
      aboutBody(
        {
          country: "United Kingdom",
          description: "I am a bot run by the newsroom.",
          videoCountText: "1,242 videos",
        },
        {
          title: "Robo",
          avatar: { thumbnails: [{ url: "https://yt3.googleusercontent.com/abc=s900" }] },
        },
      ),
    );
    expect(result).toEqual({
      status: "ok",
      channelId: CHANNEL_ID,
      signals: {
        postCount: 1242,
        country: "United Kingdom",
        bio: "I am a bot run by the newsroom.",
        declaredAutomated: true,
        declaredBy: "bio",
        displayName: "Robo",
      },
    });
  });

  it("leaves mistyped fields unobserved instead of throwing", () => {
    const result: ChannelAboutParseResult = parseChannelAbout(
      aboutBody({
        joinedDateText: "Joined Oct 15, 2013",
        videoCountText: 4,
        subscriberCountText: "many",
      }),
    );
    expect(result).toEqual({ status: "ok", channelId: CHANNEL_ID, signals: { bio: "" } });
  });

  it("stops walking a body nested deeper than any real one", () => {
    let deep: unknown = { aboutChannelViewModel: { channelId: CHANNEL_ID } };
    for (let level = 0; level < 100; level += 1) deep = { child: deep };
    expect(findAboutViewModel(deep)).toBeUndefined();
  });

  it("turns away a resolve answer that is not a channel page", () => {
    const resolve = recorded("resolve-url.json") as { endpoint: Record<string, unknown> };
    const video = {
      endpoint: {
        ...resolve.endpoint,
        commandMetadata: { webCommandMetadata: { webPageType: "WEB_PAGE_TYPE_WATCH" } },
      },
    };
    for (const body of [null, {}, { endpoint: {} }, video]) {
      expect(parseResolveUrl(body)).toBeUndefined();
    }
  });
});

describe("About texts", () => {
  it("parses join dates and counts as the English panel writes them", () => {
    expect(joinedDateMillis("Joined Apr 7, 2006")).toBe(Date.UTC(2006, 3, 7));
    expect(joinedDateMillis("Actif depuis le 26 juin 2016")).toBeUndefined();
    expect(countFromText("1 subscriber")).toBe(1);
    expect(countFromText("20.2M subscribers")).toBe(20_200_000);
    expect(countFromText("18.1K subscribers")).toBe(18_100);
    expect(countFromText("7,512,001,312 views")).toBe(7_512_001_312);
    expect(countFromText("3 abonnés")).toBeUndefined();
    expect(countFromText(undefined)).toBeUndefined();
  });
});
