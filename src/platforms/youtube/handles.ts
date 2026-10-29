/**
 * What a YouTube handle or channel name says on its own, and next to the video's creator: whether
 * YouTube assigned the handle, and whether it poses as the creator. Both are read from names only,
 * never from what a comment says (docs/scoring-spec.md, "Creator imitation").
 */
import { ASSIGNED_CODE, isAssignedCodeHandle, isUserPrefixedHandle } from "@/src/core/handleRules";

/** The channel that owns the video on the page. */
export interface VideoCreator {
  /**
   * Its handles, lowercased: the owner link's, and any comment author's that carries the creator
   * chip, so the creator's own replies are recognised even if the owner link could not be read.
   */
  handles: ReadonlySet<string>;
  /** Its name and handle as written; each is compared after normalisation. */
  names: readonly string[];
}

export function isAssignedHandle(handle: string): boolean {
  return isUserPrefixedHandle(handle) || isAssignedCodeHandle(handle);
}

/**
 * Letters from other scripts that render like Latin ones, the substitution scam names use to dodge
 * an exact match (NDSS 2024, docs/research/heuristics.md); digits are left as they are.
 */
const LOOKALIKES: Readonly<Record<string, string>> = {
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ӏ: "l",
  α: "a",
  β: "b",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
};
const COMBINING_MARKS = /\p{M}/gu;
const NOT_LETTER_OR_DIGIT = /[^a-z0-9]/g;
const DIGITS = /\d/g;
/**
 * A creator's name shorter than this is too often part of an ordinary name ("TED" in "@ted1985")
 * to say anything when a handle contains it.
 */
const MIN_CREATOR_KEY_LENGTH = 4;
/** What impersonating handles add to the creator's name ("@BBCNews-Official", "@BBCNewsTM"). */
const IMITATION_AFFIXES: ReadonlySet<string> = new Set([
  "official",
  "offical",
  "oficial",
  "real",
  "the",
  "support",
  "help",
  "helpdesk",
  "team",
  "admin",
  "manager",
  "desk",
  "hq",
  "tm",
  "inc",
  "channel",
  "page",
  "live",
  "tv",
  "verified",
  "original",
]);

/** Lowercase Latin letters and digits only, look-alike letters folded in, accents dropped. */
export function imitationKey(name: string): string {
  return [...name.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase()]
    .map((char) => LOOKALIKES[char] ?? char)
    .join("")
    .replace(NOT_LETTER_OR_DIGIT, "");
}

function posesAs(candidateKey: string, creatorKey: string): boolean {
  if (candidateKey === creatorKey) return true;
  let affix: string | undefined;
  if (candidateKey.startsWith(creatorKey)) affix = candidateKey.slice(creatorKey.length);
  else if (candidateKey.endsWith(creatorKey)) affix = candidateKey.slice(0, -creatorKey.length);
  if (affix === undefined) return false;
  const words: string = affix.replace(DIGITS, "");
  return words === "" || IMITATION_AFFIXES.has(words);
}

/**
 * Whether a handle or channel name is the creator's name or handle, alone or with digits, an
 * assigned code or one of the words impersonators add. A fan's "@bbcnewsfan" or "@ilovebbcnews"
 * does not count; "@BBC.News", "@BBCNews-x7k", "@bbcnews_official1" and a channel named "BBC Nеws"
 * with a Cyrillic "е" do. The caller makes sure the account is not the creator itself.
 */
export function imitatesCreator(candidate: string, creator: VideoCreator): boolean {
  const candidateKey: string = imitationKey(candidate.replace(ASSIGNED_CODE, ""));
  return creator.names
    .map(imitationKey)
    .some((key) => key.length >= MIN_CREATOR_KEY_LENGTH && posesAs(candidateKey, key));
}
