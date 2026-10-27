/**
 * Tier 2 parser for the public Firebase API's `GET /v0/user/<id>.json`
 * (tests/fixtures/hackernews/firebase/). The body is untrusted: every read is type-guarded, strings
 * are capped, and nothing here throws. An unknown id answers with a JSON `null`, which is told apart
 * from a malformed body so the source can cache it rather than ask again.
 */
import { bioDeclaresAutomation } from "../../../core/handle/selfDescription";
import type { UnknownRecord } from "../../../core/json/untrusted";
import { isRecord, readCount, readString } from "../../../core/json/untrusted";
import type { PartialSignals } from "../../../core/types";

export type FirebaseUserParseResult =
  | { status: "ok"; id: string; signals: PartialSignals }
  | { status: "missing" }
  | { status: "unavailable" };

const MAX_ABOUT_LENGTH = 500;
/** The about text is HTML with these entities escaped; anything else is left as written. */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&#x27;": "'",
  "&#x2F;": "/",
  "&quot;": '"',
  "&gt;": ">",
  "&lt;": "<",
  "&amp;": "&",
};
const HTML_ENTITY_PATTERN = /&#x27;|&#x2F;|&quot;|&gt;|&lt;|&amp;/g;
const HTML_TAG_PATTERN = /<[^>]*>/g;

/** The about field as plain text: paragraphs become spaces and the API's entities are decoded. */
export function aboutText(html: string): string {
  return html
    .replace(HTML_TAG_PATTERN, " ")
    .replace(HTML_ENTITY_PATTERN, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function toSignals(user: UnknownRecord): PartialSignals {
  const signals: PartialSignals = {};
  const createdSeconds: number | undefined = readCount(user, "created");
  if (createdSeconds !== undefined && createdSeconds > 0) {
    signals.createdAt = createdSeconds * 1000;
  }
  const karma: unknown = user.karma;
  if (typeof karma === "number" && Number.isSafeInteger(karma)) {
    signals.karma = karma;
  }
  // `submitted` lists every story, comment and poll the account made, newest first; only its
  // length is read, so a long history costs nothing more than counting.
  if (Array.isArray(user.submitted)) {
    signals.postCount = user.submitted.filter((item) => typeof item === "number").length;
  }
  // The API leaves `about` out when the account has none, so a delivered profile without one
  // records an empty bio rather than an unobserved one.
  const rawAbout: string | undefined = readString(user, "about");
  const about: string = rawAbout === undefined ? "" : aboutText(rawAbout);
  signals.bio = about.slice(0, MAX_ABOUT_LENGTH);
  if (bioDeclaresAutomation(about)) {
    signals.declaredAutomated = true;
    signals.declaredBy = "bio";
  }
  return signals;
}

export function parseFirebaseUser(body: unknown): FirebaseUserParseResult {
  if (body === null) return { status: "missing" };
  const id: string | undefined = isRecord(body) ? readString(body, "id") : undefined;
  if (!isRecord(body) || id === undefined) return { status: "unavailable" };
  return { status: "ok", id, signals: toSignals(body) };
}
