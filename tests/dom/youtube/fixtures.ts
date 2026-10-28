import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The recorded watch page's address, with the fake video id the recording carries. */
export const RECORDED_WATCH_URL = "https://www.youtube.com/watch?v=fs4k4h1v9go";
export const RECORDED_VIDEO_ID = "fs4k4h1v9go";
/** The recorded video's creator, BBC News, under its fake handle. */
export const RECORDED_CREATOR_HANDLE = "tomas_builds45";

let recordedBody: string | undefined;

/** Resolved from the project root: under the happy-dom environment import.meta.url is the page URL. */
function watchBody(): string {
  if (recordedBody === undefined) {
    const html: string = readFileSync(
      resolve(process.cwd(), "tests/fixtures/youtube/html/watch.html"),
      "utf8",
    );
    recordedBody = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  }
  return recordedBody;
}

/** Replaces the document body with the recorded watch page's body. */
export function loadWatchFixture(): void {
  document.body.innerHTML = watchBody();
}

/**
 * A hand-written comment in the recorded markup's shape, for what the recording does not show (a
 * creator's own comment, an outbound link, an unbound author link).
 */
export function commentMarkup(options: {
  handle?: string;
  commentId?: string;
  age?: string;
  text?: string;
  avatar?: string;
  creatorChip?: boolean;
  reply?: boolean;
}): string {
  const handle: string = options.handle ?? "maria_reads40";
  const href = `/@${handle}`;
  const chip: string = options.creatorChip
    ? `<ytd-author-comment-badge-renderer creator=""><a id="name" href="${href}">@${handle}</a></ytd-author-comment-badge-renderer>`
    : "";
  return `<ytd-comment-view-model id="comment"${options.reply ? ' is-reply=""' : ""}>
  <div id="body"><div id="author-thumbnail"><button id="author-thumbnail-button" aria-label="@${handle}"><yt-img-shadow><img id="img"${options.avatar === undefined ? "" : ` src="${options.avatar}"`}></yt-img-shadow></button></div>
  <div id="main"><div id="header"><div id="header-author"><h3><a id="author-text" href="${href}"><span> @${handle} </span></a></h3>
  <span id="author-comment-badge">${chip}</span>
  <span id="published-time-text"><a href="/watch?v=${RECORDED_VIDEO_ID}&amp;lc=${options.commentId ?? "UgwHandWritten0000000000AaABAg"}">${options.age ?? "1 hour ago"}</a></span></div></div>
  <ytd-expander id="expander"><div id="content"><yt-attributed-string id="content-text"><span>${options.text ?? "A comment written for the test."}</span></yt-attributed-string></div></ytd-expander></div></div>
</ytd-comment-view-model>`;
}
