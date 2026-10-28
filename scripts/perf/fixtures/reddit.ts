/** The Reddit generators: a feed of shreddit-post items and a nested shreddit-comment thread. */
import {
  FAKE_ADJECTIVES,
  FAKE_FIRST_NAMES,
  FAKE_NOUNS,
  FAKE_TOPICS,
} from "../../../src/core/snapshot/fakeNames.ts";
import type { Random } from "./kit.ts";
import { digits, page, pick, seededRandom, sentences } from "./kit.ts";

const MAX_COMMENT_DEPTH = 6;
const REDDIT_STOCK_AVATAR = "https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png";
/** Reddit's registered-app tag as recorded: a bare "APP" leaf in the author row. */
const REDDIT_APP_TAG = `<span class="text-12 font-semibold uppercase">APP</span>`;

const subreddits: readonly string[] = ["woodworking", "dailydeals", "askscience", "cooking"];

/** A chosen name most of the time, Reddit's suggested Adjective_Noun_1234 shape otherwise. */
function redditUsername(random: Random): string {
  return random() < 0.3
    ? `${pick(random, FAKE_ADJECTIVES)}_${pick(random, FAKE_NOUNS)}_${digits(random, 4)}`
    : `${pick(random, FAKE_FIRST_NAMES)}_${pick(random, FAKE_TOPICS)}${Math.floor(random() * 90) + 10}`;
}

function redditAuthorLink(name: string, avatar: string | undefined): string {
  const image: string =
    avatar === undefined ? "" : `<img src="${avatar}" alt="u/${name} avatar" />`;
  const link = `<a href="/user/${name}/" class="author-name">${image}u/${name}</a>`;
  return `<faceplate-hovercard aria-label="User info">${link}</faceplate-hovercard>`;
}

/**
 * One shreddit-post in either shape of tests/fixtures/reddit/html/feed.html: the credit bar slotted
 * into light DOM, or the author row only inside the declarative shadow root, which is always the
 * shape for an APP-tagged author, as recorded.
 */
function redditPost(random: Random, index: number, appTagged: boolean): string {
  const name: string = redditUsername(random);
  const subreddit: string = pick(random, subreddits);
  const id = `t3_perf${index.toString(36).padStart(4, "0")}`;
  const permalink = `/r/${subreddit}/comments/${id.slice(3)}/post_${index}/`;
  const avatarRoll: number = random();
  const avatar: string | undefined =
    avatarRoll < 0.5 ? undefined : avatarRoll < 0.65 ? REDDIT_STOCK_AVATAR : `/icons/${index}.png`;
  const community = `<a href="/r/${subreddit}/"><span class="font-bold">r/${subreddit}</span></a>`;
  const meta = `${community}<span>by</span>${redditAuthorLink(name, avatar)}`;
  const inShadow: boolean = appTagged || random() < 0.5;
  const authorRow: string = inShadow
    ? `<div class="credit-bar flex items-center">${meta}${appTagged ? REDDIT_APP_TAG : ""}</div>`
    : `<slot name="credit-bar"></slot>`;
  return [
    `<article class="w-full m-0"><shreddit-post id="${id}" author="${name}"`,
    ` author-id="t2_${index}" created-timestamp="2026-10-21T09:41:00.000+0000"`,
    ` subreddit-prefixed-name="r/${subreddit}" post-title="Post ${index}" permalink="${permalink}"`,
    ` post-type="link" score="${Math.floor(random() * 500)}" comment-count="${index % 80}">`,
    `<template shadowrootmode="open"><div class="post-container">${authorRow}`,
    `<slot name="title"></slot><slot name="post-footer"></slot></div></template>`,
    inShadow ? "" : `<div slot="credit-bar" class="flex items-center">${meta}</div>`,
    `<a slot="title" href="${permalink}">Post ${index}: ${pick(random, sentences)}</a>`,
    `<div slot="post-footer"></div></shreddit-post></article>`,
  ].join("");
}

/** Markup for `count` feed posts, every tenth APP-tagged; the runner reuses it for live insertion. */
export function redditFeedPosts(count: number, seed: number, firstIndex = 0): string {
  const random: Random = seededRandom(seed);
  return Array.from({ length: count }, (_, offset) => {
    const index: number = firstIndex + offset;
    return redditPost(random, index, index % 10 === 3);
  }).join("\n");
}

interface CommentNode {
  readonly depth: number;
  readonly children: CommentNode[];
}

/** Each comment replies to a random comment that can still nest, or starts a new top-level one. */
function commentForest(random: Random, count: number): CommentNode[] {
  const roots: CommentNode[] = [];
  const nestable: CommentNode[] = [];
  for (let created = 0; created < count; created += 1) {
    const parent: CommentNode | undefined =
      random() < 0.8 ? nestable[Math.floor(random() * nestable.length)] : undefined;
    const node: CommentNode = { depth: parent === undefined ? 0 : parent.depth + 1, children: [] };
    (parent?.children ?? roots).push(node);
    if (node.depth < MAX_COMMENT_DEPTH) nestable.push(node);
  }
  return roots;
}

function redditComment(
  random: Random,
  node: CommentNode,
  ids: { next: number },
  parentId: string,
): string {
  const name: string = redditUsername(random);
  const appTagged: boolean = ids.next % 50 === 17;
  const id = `t1_perf${(ids.next++).toString(36).padStart(4, "0")}`;
  const avatar: string | undefined = random() < 0.4 ? REDDIT_STOCK_AVATAR : undefined;
  const slots: string = ["commentMeta", "comment", "actionRow", "children"]
    .map((slot) => `<slot name="${slot}"></slot>`)
    .join("");
  return [
    `<shreddit-comment${node.depth === 0 ? "" : ` slot="children"`} author="${name}" thingid="${id}"`,
    ` postid="t3_perfthread" parentid="${parentId}" depth="${node.depth}" score="${ids.next % 60}">`,
    `<template shadowrootmode="open"><div class="comment">${slots}</div></template>`,
    `<div slot="commentMeta" class="flex items-center">${redditAuthorLink(name, avatar)}`,
    appTagged ? REDDIT_APP_TAG : "",
    `<faceplate-timeago ts="2026-10-21T02:05:00.000+0000">1 day ago</faceplate-timeago></div>`,
    `<div slot="comment"><p>${pick(random, sentences)}</p></div>`,
    ...node.children.map((child) => redditComment(random, child, ids, id)),
    `</shreddit-comment>`,
  ].join("");
}

export function redditCommentsPage(count: number): string {
  const random: Random = seededRandom(count);
  const ids = { next: 0 };
  const comments: string = commentForest(random, count)
    .map((root) => redditComment(random, root, ids, ""))
    .join("\n");
  const post: string = redditFeedPosts(1, 99, 9_000).replace(/^<article[^>]*>|<\/article>$/g, "");
  return page(
    "reddit",
    [
      `One post and ${count} shreddit-comment items nested up to depth ${MAX_COMMENT_DEPTH}, in the`,
      "shape of tests/fixtures/reddit/html/comments.html; every 50th carries the APP tag.",
    ],
    `<shreddit-app>${post}<shreddit-comment-tree id="comment-tree">\n${comments}\n</shreddit-comment-tree></shreddit-app>`,
  );
}
