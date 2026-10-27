/**
 * Posts keep their text under `legacy.full_text` and their author under `core.user_results.result`.
 */
import type { UnknownRecord } from "@/src/core/json/untrusted";
import { readRecord, readString } from "@/src/core/json/untrusted";
import type { AccountRef } from "@/src/core/types";
import { expandedLinksOf } from "../postLinks";
import type { ParsedXPost, ParsedXUser } from "./types";
import { asUser, parseXTimestamp } from "./userFields";

const MAX_SINGLE_POST_TEXT_LENGTH = 1_000;

// MARK: - Posts

/** The text of a long post; `legacy.full_text` holds only its first 280 characters. */
function longPostTextOf(node: UnknownRecord): string | undefined {
  // GUESS: long posts carry their whole text at note_tweet.note_tweet_results.result.text, as X's
  // public payloads have; no recorded body under tests/fixtures/x/graphql/ contains a long post yet.
  const noteResult: UnknownRecord | undefined = readRecord(
    readRecord(readRecord(node, "note_tweet"), "note_tweet_results"),
    "result",
  );
  return readString(noteResult, "text");
}

/**
 * GUESS: a reply names the post it answers at legacy.in_reply_to_status_id_str (empty or absent on
 * any other post) and the answered user at legacy.in_reply_to_user_id_str, else
 * legacy.in_reply_to_screen_name; no recorded body under tests/fixtures/x/graphql/ carries a
 * replies tab yet. An answered user that is the author makes it a thread continuation, not a reply.
 */
function answersAnotherPost(legacy: UnknownRecord, author: AccountRef): boolean {
  if ((readString(legacy, "in_reply_to_status_id_str") ?? "") === "") {
    return false;
  }
  const answeredUserId: string | undefined = readString(legacy, "in_reply_to_user_id_str");
  if (answeredUserId !== undefined && answeredUserId !== "" && author.id !== undefined) {
    return answeredUserId !== author.id;
  }
  const answeredScreenName: string = readString(legacy, "in_reply_to_screen_name") ?? "";
  return answeredScreenName === "" || answeredScreenName.toLowerCase() !== author.handle;
}

/** A post object: its own `rest_id`, a `legacy` block, and its author under `core.user_results`. */
export function asPost(node: UnknownRecord): ParsedXPost | undefined {
  const legacy: UnknownRecord | undefined = readRecord(node, "legacy");
  const authorNode: UnknownRecord | undefined = readRecord(
    readRecord(readRecord(node, "core"), "user_results"),
    "result",
  );
  const id: string | undefined = readString(node, "rest_id");
  const author: ParsedXUser | undefined = authorNode === undefined ? undefined : asUser(authorNode);
  if (id === undefined || legacy === undefined || author === undefined) {
    return undefined;
  }
  // A repost wrapper is never a reply, and neither is a thread continuation: a post answering its own
  // author is the author continuing a thread, which a human does as often as a bot.
  const isRepost: boolean = readRecord(legacy, "retweeted_status_result") !== undefined;
  const isReply: boolean = !isRepost && answersAnotherPost(legacy, author.ref);
  const post: ParsedXPost = { id, author: author.ref, isReply };
  // A repost's text is the reposted author's words, and their language is not this account's; the
  // reposted post itself is walked into and credited to its own author.
  const text: string | undefined = isRepost
    ? undefined
    : (longPostTextOf(node) ?? readString(legacy, "full_text"));
  if (text !== undefined) {
    post.text = text.slice(0, MAX_SINGLE_POST_TEXT_LENGTH);
  }
  const links: string[] = isRepost ? [] : expandedLinksOf(node);
  if (links.length > 0) {
    post.links = links;
  }
  // GUESS: a post's own time is legacy.created_at in X's weekday-first format, as on the user
  // object; the recorded timeline bodies under tests/fixtures/x/graphql/ do not carry it.
  const createdAt: number | undefined = parseXTimestamp(readString(legacy, "created_at"));
  if (createdAt !== undefined) {
    post.createdAt = createdAt;
  }
  return post;
}
