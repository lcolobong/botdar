/**
 * A Hacker News comment as the thread index records it (ADR-0027). A thread is the page at
 * `item?id=<id>`: the item it names (a story, or a comment opened on its own) is the root, and every
 * other comment row on the page is a reply in it. /newcomments mixes comments from many threads,
 * a few each, and is not read. Recorded on 2026-10-27 (tests/fixtures/hackernews/html/thread.html).
 */
import type { ThreadRootLinks } from "../../core/thread/replyText";
import { linksField, pageTimestampMillis, webLinksIn } from "../../core/thread/replyText";
import type { ThreadReply } from "../../core/thread/threadIndex";
import type { HackerNewsRow } from "./dom";
import { classify } from "./dom";

const THREAD_PATH = "/item";
const COMMENT_TEXT_SELECTOR = ".commtext";
/** `title` is the UTC time, "2026-10-26T18:05:03", sometimes followed by the Unix time. */
const COMMENT_AGE_SELECTOR = ".comhead .age[title]";
/** Hacker News has no quote markup: a quoted line is a paragraph that starts with ">". */
const QUOTE_MARKER = ">";
const PARAGRAPH_TAG = "P";
/**
 * The head item's links: a story's title link, a comment's own links when a comment is the head,
 * and the text of an Ask or Show story, which renders in the head table below the item's row.
 */
const ROOT_ROW_LINKS_SELECTOR = ".titleline > a, .commtext";
const ROOT_TEXT_SELECTOR = ".fatitem .toptext";

/** The root item's id, or undefined on any page that is not a thread. */
export function threadKeyOf(pageUrl: URL): string | undefined {
  return pageUrl.pathname === THREAD_PATH
    ? (pageUrl.searchParams.get("id") ?? undefined)
    : undefined;
}

function postedAtOf(row: Element): number | undefined {
  const stamp: string = row.querySelector(COMMENT_AGE_SELECTOR)?.getAttribute("title") ?? "";
  return pageTimestampMillis(stamp.split(" ")[0] ?? "");
}

/**
 * The comment's own paragraphs: the text before the first `<p>` is the first paragraph, each `<p>`
 * another, and a paragraph that opens with ">" quotes someone else and is left out.
 */
function unquotedTextOf(commentText: Element): string {
  const paragraphs: string[] = [""];
  for (const node of commentText.childNodes) {
    const text: string = node.textContent ?? "";
    if (node instanceof Element && node.tagName === PARAGRAPH_TAG) {
      paragraphs.push(text);
    } else {
      paragraphs[paragraphs.length - 1] += text;
    }
  }
  return paragraphs
    .filter((paragraph) => !paragraph.trimStart().startsWith(QUOTE_MARKER))
    .join("\n");
}

/**
 * The row as a reply in the page's thread, or undefined for the root, a story or any other page. The
 * observer classifies each row once and passes the result, which it keeps for the badge.
 */
export function threadReplyOf(
  row: Element,
  pageUrl: URL,
  classified: HackerNewsRow = classify(row),
): ThreadReply | undefined {
  const threadKey: string | undefined = threadKeyOf(pageUrl);
  // The front page and /newest are not threads; their rows are turned away before any DOM read.
  if (threadKey === undefined) {
    return undefined;
  }
  if (
    classified.status !== "post" ||
    classified.post.kind !== "comment" ||
    row.id === "" ||
    row.id === threadKey
  ) {
    return undefined;
  }
  const commentText: Element | null = row.querySelector(COMMENT_TEXT_SELECTOR);
  const postedAt: number | undefined = postedAtOf(row);
  if (commentText === null || postedAt === undefined) {
    return undefined;
  }
  const parentId: string | undefined = classified.post.parentId;
  return {
    threadKey,
    replyId: row.id,
    author: classified.post.ref.handle,
    text: unquotedTextOf(commentText),
    postedAt,
    ...(parentId === undefined ? {} : { parentId }),
    ...linksField(webLinksIn(commentText)),
  };
}

/** The head item of the page's thread, read for its links; undefined for every other row. */
export function threadRootLinksOf(row: Element, pageUrl: URL): ThreadRootLinks | undefined {
  const threadKey: string | undefined = threadKeyOf(pageUrl);
  if (threadKey === undefined || row.id !== threadKey) {
    return undefined;
  }
  const containers: Element[] = [
    ...row.querySelectorAll(ROOT_ROW_LINKS_SELECTOR),
    ...row.ownerDocument.querySelectorAll(ROOT_TEXT_SELECTOR),
  ];
  return {
    threadKey,
    links: containers.flatMap((container) =>
      container.matches("a") ? [container.getAttribute("href") ?? ""] : webLinksIn(container),
    ),
  };
}
