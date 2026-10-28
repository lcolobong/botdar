/** The X generator: tweet cells in the recorded timeline shape and the HomeTimeline body that scores them. */
import { FAKE_FIRST_NAMES, FAKE_TOPICS } from "../../../src/core/snapshot/fakeNames.ts";
import type { Random } from "./kit.ts";
import { digits, page, pick, seededRandom, sentences } from "./kit.ts";

/** The X page fetches this; the interceptor accepts any query id of the right shape. */
export const perfHomeTimelinePath = "/i/api/graphql/PERFQUERYID000000001/HomeTimeline";
/** Account ages in the X body count back from this date, like the recorded fixtures. */
const RECORDING_DATE_MS: number = Date.parse("2026-10-22T12:00:00.000Z");
const DAY_MS = 86_400_000;
const X_STOCK_AVATAR =
  "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png";

interface XAuthor {
  readonly handle: string;
  readonly name: string;
  readonly automated: boolean;
  readonly likelyBot: boolean;
  readonly avatar: string;
}

function xAuthor(random: Random, index: number): XAuthor {
  const likelyBot: boolean = index % 20 === 13;
  const automated: boolean = index % 20 === 7;
  const first: string = pick(random, FAKE_FIRST_NAMES);
  return {
    handle: likelyBot
      ? `${first}${digits(random, 8)}`
      : `${first}_${pick(random, FAKE_TOPICS)}${index}`,
    name: `${first.charAt(0).toUpperCase()}${first.slice(1)}`,
    automated,
    likelyBot,
    avatar: automated || likelyBot ? X_STOCK_AVATAR : `https://pbs.twimg.com/${index}_normal.jpg`,
  };
}

/** The article shape of tests/fixtures/x/html/timeline.html; the Automated and reply rows are optional. */
function xArticle(random: Random, author: XAuthor): string {
  const span = (text: string): string =>
    `<span class="css-1jxf684 r-bcqeeo r-poiln3">${text}</span>`;
  const profileLink = (inner: string): string =>
    `<a href="/${author.handle}" role="link">${inner}</a>`;
  const div = (...children: string[]): string =>
    `<div class="css-175oi2r">${children.join("")}</div>`;
  const repliedTo = `<a href="/alice_reads1" role="link">${span("@alice_reads1")}</a>`;
  return [
    `<div data-testid="cellInnerDiv"><article data-testid="tweet" role="article" tabindex="0">`,
    div(
      div(
        `<div data-testid="Tweet-User-Avatar">`,
        div(profileLink(`<img alt="" src="${author.avatar}" />`)),
        `</div>`,
      ),
      div(
        div(
          div(
            `<div data-testid="User-Name" class="css-175oi2r">`,
            div(div(profileLink(`<div dir="ltr">${span(span(author.name))}</div>`))),
            div(
              div(profileLink(`<div dir="ltr">${span(`@${author.handle}`)}</div>`)),
              `<div dir="ltr" aria-hidden="true">${span("·")}</div>`,
              div(profileLink(`<time datetime="2026-10-22T08:10:00.000Z">2h</time>`)),
            ),
            author.automated ? div(span("Automated")) : "",
            `</div>`,
          ),
        ),
        random() < 0.1 ? div(`<div dir="ltr">${span("Replying to ")}${repliedTo}</div>`) : "",
        div(
          `<div data-testid="tweetText" dir="auto" lang="en">${span(pick(random, sentences))}</div>`,
        ),
      ),
    ),
    `</article></div>`,
  ].join("");
}

/** A user object in the shape of tests/fixtures/x/graphql/home-timeline-core.json. */
function xUser(author: XAuthor, index: number): Record<string, unknown> {
  const ageDays: number = author.likelyBot ? 10 : 400 + index * 7;
  const stockAvatar: boolean = author.avatar === X_STOCK_AVATAR;
  return {
    __typename: "User",
    rest_id: `1${String(index).padStart(18, "0")}`,
    affiliates_highlighted_label: author.automated
      ? { label: { userLabelType: "AutomatedLabel", description: "Automated" } }
      : {},
    avatar: { image_url: author.avatar },
    core: {
      created_at: new Date(RECORDING_DATE_MS - ageDays * DAY_MS).toISOString(),
      name: author.name,
      screen_name: author.handle,
    },
    is_blue_verified: false,
    legacy: { default_profile: stockAvatar, default_profile_image: stockAvatar },
    profile_bio: { description: author.likelyBot ? "" : "Opinions are my own." },
    relationship_counts: author.likelyBot
      ? { followers: 12, following: 4900 }
      : { followers: 340 + index, following: 210 },
    tweet_counts: { tweets: author.likelyBot ? 1500 : 4100, media_tweets: 40 },
    verification: { verified: false },
  };
}

export function xTimeline(count: number, bodyFile: string): { html: string; body: string } {
  const random: Random = seededRandom(count);
  const authors: XAuthor[] = Array.from({ length: count }, (_, index) => xAuthor(random, index));
  const articles: string = authors.map((author) => xArticle(random, author)).join("\n");
  const entries = authors.map((author, index) => {
    const tweet = { __typename: "Tweet", core: { user_results: { result: xUser(author, index) } } };
    const itemContent = { itemType: "TimelineTweet", tweet_results: { result: tweet } };
    return {
      entryId: `tweet-${index}`,
      content: { entryType: "TimelineTimelineItem", itemContent },
    };
  });
  const instructions = [{ type: "TimelineAddEntries", entries }];
  const script = `    <script>
      // Fetches the HomeTimeline body like the web app does, so the MAIN-world interceptor relays it
      // to Tier 1; repeated because the content script only subscribes at document_idle.
      window.addEventListener("load", () => {
        for (const delay of [0, 500, 1500]) {
          setTimeout(() => fetch("${perfHomeTimelinePath}").catch(() => undefined), delay);
        }
      });
    </script>`;
  const html: string = page(
    "Home / X",
    [
      `${count} article[data-testid="tweet"] cells in the shape of tests/fixtures/x/html/timeline.html.`,
      "Authors 7, 27, 47, ... carry the Automated label; authors 13, 33, 53, ... are ten-day-old",
      `name-plus-digits accounts whose counts in ${bodyFile} score Likely bot.`,
    ],
    `<div id="react-root"><main role="main"><div aria-label="Timeline: Your Home Timeline">\n${articles}\n</div></main></div>`,
    script,
  );
  return {
    html,
    body: `${JSON.stringify({ data: { home: { home_timeline_urt: { instructions } } } })}\n`,
  };
}
