/**
 * Bodies are untrusted page data: every read is type-guarded, strings are capped, the walk is
 * bounded, and nothing here throws.
 */
import { isRecord } from "@/src/core/json/untrusted";
import { MAX_POST_TEXT_LENGTH } from "@/src/core/types";
import { asPost } from "./posts";
import type { ParsedXBody, ParsedXPost, ParsedXUser } from "./types";
import { asUser } from "./userFields";

const MAX_WALK_NODES = 200_000;
const MAX_USERS_PER_RESPONSE = 500;
const MAX_POSTS_PER_RESPONSE = 500;

// MARK: - Walk

/**
 * Every user object and every post anywhere in a GraphQL body, in document order, each deduplicated
 * by its `rest_id`. A post is walked into (its author, a quoted or reposted post), a user is not. The
 * walk is iterative and bounded so a hostile or enormous body cannot stall the content script.
 */
export function parseGraphqlBody(body: unknown): ParsedXBody {
  const users: ParsedXUser[] = [];
  const posts: ParsedXPost[] = [];
  const seenIds = new Set<string>();
  const visited = new WeakSet<object>();
  const pending: unknown[] = [body];
  let visitedCount = 0;
  while (pending.length > 0 && visitedCount < MAX_WALK_NODES) {
    const node: unknown = pending.pop();
    if (typeof node !== "object" || node === null || visited.has(node)) {
      continue;
    }
    visited.add(node);
    visitedCount += 1;
    const children: unknown[] = Array.isArray(node) ? node : [];
    if (isRecord(node)) {
      const user: ParsedXUser | undefined = asUser(node);
      if (user !== undefined) {
        if (user.ref.id !== undefined && !seenIds.has(user.ref.id)) {
          seenIds.add(user.ref.id);
          if (users.length < MAX_USERS_PER_RESPONSE) {
            users.push(user);
          }
        }
        continue;
      }
      const post: ParsedXPost | undefined = asPost(node);
      if (post !== undefined && !seenIds.has(post.id) && posts.length < MAX_POSTS_PER_RESPONSE) {
        seenIds.add(post.id);
        posts.push(post);
      }
      children.push(...Object.values(node));
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return { users, posts };
}

export function collectUsers(body: unknown): ParsedXUser[] {
  return parseGraphqlBody(body).users;
}

/** Each author's post text in one body, joined in document order and capped for the detector. */
export function postTextByHandle(posts: ParsedXPost[]): Map<string, string> {
  const texts = new Map<string, string>();
  for (const post of posts) {
    if (post.text === undefined) {
      continue;
    }
    const earlier: string | undefined = texts.get(post.author.handle);
    const joined: string = earlier === undefined ? post.text : `${earlier}\n${post.text}`;
    texts.set(post.author.handle, joined.slice(0, MAX_POST_TEXT_LENGTH));
  }
  return texts;
}
