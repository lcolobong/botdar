/**
 * Tier 2 parsers for YouTube's innertube API (tests/fixtures/youtube/innertube/, recorded
 * 2026-10-27): `navigation/resolve_url`, which turns a channel's About address into its channel id
 * and the About tab's params, and `browse`, whose About panel (`aboutChannelViewModel`) carries the
 * join date and the subscriber, view and video counts. The view model is found wherever it sits, so
 * the same parser reads the browse the source makes and the continuation the page sends when its
 * About panel opens. Bodies are untrusted: every read is type-guarded, the walk is bounded, strings
 * are capped and nothing throws. Texts are read in English: the source asks for `hl: "en"`.
 */
import { bioDeclaresAutomation } from "../../../core/handle/selfDescription";
import type { UnknownRecord } from "../../../core/json/untrusted";
import { isRecord, readRecord, readString } from "../../../core/json/untrusted";
import type { PartialSignals } from "../../../core/types";

export interface ChannelEndpoint {
  browseId: string;
  params: string;
}

export type ChannelAboutParseResult =
  { status: "ok"; channelId: string; signals: PartialSignals } | { status: "unavailable" };

const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/;
const CHANNEL_PAGE_TYPE = "WEB_PAGE_TYPE_CHANNEL";
const ABOUT_VIEW_MODEL_KEY = "aboutChannelViewModel";
/** A browse body holds a few thousand nodes; a hostile one cannot make the walk run away. */
const MAX_VISITED_NODES = 200_000;
const MAX_DEPTH = 40;
const MAX_TEXT_LENGTH = 500;
const MONTHS: readonly string[] = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "Joined Oct 15, 2013". */
const JOINED_PATTERN = /^Joined ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/;
/** "1 subscriber", "20.2M subscribers", "1,242 videos". */
const COUNT_PATTERN = /^([\d,]+(?:\.\d+)?)([KMB])?\s+[a-z]+$/;
const COUNT_MULTIPLIERS: Readonly<Record<string, number>> = { K: 1e3, M: 1e6, B: 1e9 };

/** The channel the About address names, or undefined when the answer is not a channel page. */
export function parseResolveUrl(body: unknown): ChannelEndpoint | undefined {
  const endpoint: UnknownRecord | undefined = readRecord(
    isRecord(body) ? body : undefined,
    "endpoint",
  );
  const pageType: string | undefined = readString(
    readRecord(readRecord(endpoint, "commandMetadata"), "webCommandMetadata"),
    "webPageType",
  );
  const browse: UnknownRecord | undefined = readRecord(endpoint, "browseEndpoint");
  const browseId: string | undefined = readString(browse, "browseId");
  const params: string | undefined = readString(browse, "params");
  if (pageType !== CHANNEL_PAGE_TYPE || browseId === undefined || params === undefined) {
    return undefined;
  }
  return CHANNEL_ID_PATTERN.test(browseId) ? { browseId, params } : undefined;
}

/** The first `aboutChannelViewModel` in the body, depth first, within the walk's bounds. */
export function findAboutViewModel(body: unknown): UnknownRecord | undefined {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: body, depth: 0 }];
  for (let visited = 0; stack.length > 0 && visited < MAX_VISITED_NODES; visited += 1) {
    const { node, depth } = stack.pop() ?? { node: undefined, depth: 0 };
    if (depth > MAX_DEPTH || typeof node !== "object" || node === null) continue;
    if (isRecord(node) && isRecord(node[ABOUT_VIEW_MODEL_KEY])) {
      return node[ABOUT_VIEW_MODEL_KEY] as UnknownRecord;
    }
    const children: unknown[] = Array.isArray(node) ? node : Object.values(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: depth + 1 });
    }
  }
  return undefined;
}

/** Epoch milliseconds (UTC midnight) of "Joined Oct 15, 2013"; undefined for any other text. */
export function joinedDateMillis(text: string | undefined): number | undefined {
  const match: RegExpExecArray | null = JOINED_PATTERN.exec(text?.trim() ?? "");
  const month: number = MONTHS.indexOf(match?.[1] ?? "");
  if (match === null || month < 0) return undefined;
  const millis: number = Date.UTC(Number(match[3]), month, Number(match[2]));
  return Number.isFinite(millis) && millis > 0 ? millis : undefined;
}

/** "20.2M subscribers" → 20,200,000; undefined for text that is not a count. */
export function countFromText(text: string | undefined): number | undefined {
  const match: RegExpExecArray | null = COUNT_PATTERN.exec(text?.trim() ?? "");
  if (match === null) return undefined;
  const value: number = Number((match[1] ?? "").replace(/,/g, ""));
  const multiplier: number = COUNT_MULTIPLIERS[match[2] ?? ""] ?? 1;
  return Number.isFinite(value) ? Math.round(value * multiplier) : undefined;
}

function cappedText(value: string | undefined): string | undefined {
  return value?.trim().slice(0, MAX_TEXT_LENGTH);
}

function toSignals(about: UnknownRecord, channel: UnknownRecord | undefined): PartialSignals {
  const signals: PartialSignals = {};
  const createdAt: number | undefined = joinedDateMillis(
    readString(readRecord(about, "joinedDateText"), "content"),
  );
  if (createdAt !== undefined) signals.createdAt = createdAt;
  // A count YouTube has nothing to show for is left out of the panel. For videos that means none
  // in public; a subscriber count can also be hidden by its owner, so its absence stays unknown.
  const videoCountText: unknown = about.videoCountText;
  const videos: number | undefined =
    videoCountText === undefined
      ? 0
      : countFromText(typeof videoCountText === "string" ? videoCountText : undefined);
  if (videos !== undefined) signals.postCount = videos;
  const subscribers: number | undefined = countFromText(readString(about, "subscriberCountText"));
  if (subscribers !== undefined) signals.followers = subscribers;
  const country: string | undefined = cappedText(readString(about, "country"));
  if (country !== undefined && country.length > 0) signals.country = country;
  const description: string =
    cappedText(readString(about, "description") ?? readString(channel, "description")) ?? "";
  signals.bio = description;
  if (bioDeclaresAutomation(description)) {
    signals.declaredAutomated = true;
    signals.declaredBy = "bio";
  }
  const title: string | undefined = cappedText(readString(channel, "title"));
  if (title !== undefined && title.length > 0) signals.displayName = title;
  return signals;
}

/**
 * The channel's About facts from a browse body, or `unavailable` when it carries no About panel
 * with a channel id (a missing channel, a changed shape, a mangled body).
 */
export function parseChannelAbout(body: unknown): ChannelAboutParseResult {
  const about: UnknownRecord | undefined = findAboutViewModel(body);
  const channelId: string | undefined = readString(about, "channelId");
  if (about === undefined || channelId === undefined || !CHANNEL_ID_PATTERN.test(channelId)) {
    return { status: "unavailable" };
  }
  const channel: UnknownRecord | undefined = readRecord(
    readRecord(isRecord(body) ? body : undefined, "metadata"),
    "channelMetadataRenderer",
  );
  return { status: "ok", channelId, signals: toSignals(about, channel) };
}
