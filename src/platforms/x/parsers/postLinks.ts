/**
 * The pages an X post links, as X's API states them, for the shared rare domain feature
 * (ADR-0029). The page renders every link through t.co, so the DOM cannot say where one leads;
 * the post object carries each link's target as `legacy.entities.urls[].expanded_url`, the field
 * X documents. A long post keeps its links with its full text under `note_tweet` (GUESS, as for
 * its text in graphqlUsers.ts: no recorded body holds a long post yet). Untrusted page data: every
 * read is type-guarded and the count is capped.
 */
import type { UnknownRecord } from "../../../core/json/untrusted";
import { isRecord, readRecord, readString } from "../../../core/json/untrusted";

const MAX_LINKS_PER_POST = 10;
const MAX_LINK_LENGTH = 2_048;

function expandedUrlsIn(entities: UnknownRecord | undefined): string[] {
  const urls: unknown = entities?.urls;
  if (!Array.isArray(urls)) {
    return [];
  }
  return urls
    .filter(isRecord)
    .map((url) => readString(url, "expanded_url"))
    .filter((link): link is string => link !== undefined && link.length <= MAX_LINK_LENGTH);
}

/** The expanded links of a post object, distinct, at most ten. */
export function expandedLinksOf(post: UnknownRecord): string[] {
  const noteEntities: UnknownRecord | undefined = readRecord(
    readRecord(readRecord(readRecord(post, "note_tweet"), "note_tweet_results"), "result"),
    "entity_set",
  );
  const links = new Set<string>([
    ...expandedUrlsIn(readRecord(readRecord(post, "legacy"), "entities")),
    ...expandedUrlsIn(noteEntities),
  ]);
  return [...links].slice(0, MAX_LINKS_PER_POST);
}
