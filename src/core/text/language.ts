/**
 * A small bundled language detector for an account's own text (its bio and the posts a page already
 * fetched). Deterministic, no network, no model: the writing system decides first, and for Latin and
 * Cyrillic text a stopword profile per language (stopwords.json) picks among the languages that share
 * the script. It answers only when the text is long enough and one language clearly leads; a short
 * bio, an even mix or an unknown language reads as undefined, never as a guess.
 */
import table from "./stopwords.json" with { type: "json" };

export interface DetectedLanguage {
  /** ISO 639-1 code, e.g. "es". */
  language: string;
  /** 0..1: the dominant script's share, or how far the leading stopword profile is ahead. */
  confidence: number;
}

/** Below this many words a bio is mostly names and emoji, and any profile match is chance. */
export const MIN_WORDS = 12;
/** The leading profile must be this far ahead of the runner-up, as a share of its own score. */
const MIN_CONFIDENCE = 0.3;
/** About three distinct function words: one shared "de" or "a" must not decide anything. */
const MIN_PROFILE_SCORE = 2;
const DOMINANT_SCRIPT_MIN_SHARE = 0.6;
const DISTINCTIVE_CHARACTER_BONUS = 0.5;
const MAX_DISTINCTIVE_BONUS = 2;
/** Enough for a bio and a page of posts; longer input only costs time. */
const MAX_TEXT_LENGTH = 4000;
/** Chinese, Japanese and Thai put no spaces between words; two characters stand in for one. */
const CHARACTERS_PER_UNSPACED_WORD = 2;
/** Japanese mixes kana into Han text; Chinese uses none. */
const JAPANESE_MIN_KANA_SHARE = 0.1;
/** Two or more Urdu-only letters, else Persian-only letters, tell those apart from Arabic. */
const ARABIC_SCRIPT_MIN_HINTS = 2;

/**
 * Every script the detector tells apart, with the one language that writes it where there is one
 * (Marathi and Nepali share Devanagari with Hindi, whose plausible regions cover both). Latin comes
 * first because it is by far the most common, so most letters match on the first test.
 */
const SCRIPTS = [
  { script: "latin", pattern: /\p{Script=Latin}/u },
  { script: "cyrillic", pattern: /\p{Script=Cyrillic}/u },
  { script: "arabic", pattern: /\p{Script=Arabic}/u },
  { script: "han", pattern: /\p{Script=Han}/u, unspaced: true },
  { script: "kana", pattern: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, unspaced: true },
  { script: "hangul", pattern: /\p{Script=Hangul}/u, language: "ko" },
  { script: "devanagari", pattern: /\p{Script=Devanagari}/u, language: "hi" },
  { script: "thai", pattern: /\p{Script=Thai}/u, language: "th", unspaced: true },
  { script: "hebrew", pattern: /\p{Script=Hebrew}/u, language: "he" },
  { script: "greek", pattern: /\p{Script=Greek}/u, language: "el" },
  { script: "bengali", pattern: /\p{Script=Bengali}/u, language: "bn" },
  { script: "tamil", pattern: /\p{Script=Tamil}/u, language: "ta" },
  { script: "telugu", pattern: /\p{Script=Telugu}/u, language: "te" },
  { script: "gujarati", pattern: /\p{Script=Gujarati}/u, language: "gu" },
  { script: "gurmukhi", pattern: /\p{Script=Gurmukhi}/u, language: "pa" },
  { script: "kannada", pattern: /\p{Script=Kannada}/u, language: "kn" },
  { script: "malayalam", pattern: /\p{Script=Malayalam}/u, language: "ml" },
  { script: "sinhala", pattern: /\p{Script=Sinhala}/u, language: "si" },
  { script: "lao", pattern: /\p{Script=Lao}/u, language: "lo", unspaced: true },
  { script: "khmer", pattern: /\p{Script=Khmer}/u, language: "km", unspaced: true },
  { script: "myanmar", pattern: /\p{Script=Myanmar}/u, language: "my", unspaced: true },
  { script: "georgian", pattern: /\p{Script=Georgian}/u, language: "ka" },
  { script: "armenian", pattern: /\p{Script=Armenian}/u, language: "hy" },
  { script: "ethiopic", pattern: /\p{Script=Ethiopic}/u, language: "am" },
] as const;

type ScriptEntry = (typeof SCRIPTS)[number];
type Script = ScriptEntry["script"];

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/giu;
const MENTION_OR_TAG_PATTERN = /[@#][\p{L}\p{N}_.-]+/gu;
const LETTER_PATTERN = /\p{L}/u;
const WORD_SEPARATOR_PATTERN = /[^\p{L}\p{M}]+/u;
const URDU_ONLY_LETTERS = /[\u{0679}\u{0688}\u{0691}\u{06BA}\u{06BE}\u{06C1}\u{06D2}]/gu;
const PERSIAN_LETTERS = /[\u{067E}\u{0686}\u{0698}\u{06AF}\u{06A9}\u{06CC}]/gu;
/** Latin Extended Additional: the stacked tone marks only Vietnamese writes. */
const VIETNAMESE_TONE_LETTERS = /[\u{1EA0}-\u{1EF9}]/gu;

const stopwordLists: Readonly<Record<string, string>> = table.stopwords;
const distinctiveCharacters: Readonly<Record<string, string>> = table.distinctiveCharacters;

/** Each word maps to every language that lists it, so a shared word counts as a fraction. */
const LANGUAGES_BY_WORD: ReadonlyMap<string, readonly string[]> = (() => {
  const byWord = new Map<string, string[]>();
  for (const [language, words] of Object.entries(stopwordLists)) {
    for (const word of new Set(words.split(" "))) {
      byWord.set(word, [...(byWord.get(word) ?? []), language]);
    }
  }
  return byWord;
})();

function scriptOf(character: string): ScriptEntry | undefined {
  return SCRIPTS.find((entry) => entry.pattern.test(character));
}

function cleanedText(text: string): string {
  return text
    .slice(0, MAX_TEXT_LENGTH)
    .normalize("NFC")
    .replace(URL_PATTERN, " ")
    .replace(MENTION_OR_TAG_PATTERN, " ")
    .toLowerCase();
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function letterCountsByScript(text: string): { counts: Map<Script, number>; total: number } {
  const counts = new Map<Script, number>();
  let total = 0;
  for (const character of text) {
    if (!LETTER_PATTERN.test(character)) {
      continue;
    }
    total += 1;
    const script: Script | undefined = scriptOf(character)?.script;
    if (script !== undefined) {
      counts.set(script, (counts.get(script) ?? 0) + 1);
    }
  }
  return { counts, total };
}

function arabicScriptLanguage(text: string): string {
  if (countMatches(text, URDU_ONLY_LETTERS) >= ARABIC_SCRIPT_MIN_HINTS) {
    return "ur";
  }
  return countMatches(text, PERSIAN_LETTERS) >= ARABIC_SCRIPT_MIN_HINTS ? "fa" : "ar";
}

function distinctiveBonus(text: string, language: string): number {
  let occurrences = 0;
  for (const character of distinctiveCharacters[language] ?? "") {
    occurrences += text.split(character).length - 1;
  }
  if (language === "vi") {
    occurrences += countMatches(text, VIETNAMESE_TONE_LETTERS);
  }
  return Math.min(occurrences * DISTINCTIVE_CHARACTER_BONUS, MAX_DISTINCTIVE_BONUS);
}

/** The stopword profile that clearly leads, for text in a script many languages share. */
function profileLanguage(text: string, words: string[]): DetectedLanguage | undefined {
  const scores = new Map<string, number>();
  for (const word of words) {
    const languages: readonly string[] | undefined = LANGUAGES_BY_WORD.get(word);
    for (const language of languages ?? []) {
      scores.set(language, (scores.get(language) ?? 0) + 1 / (languages?.length ?? 1));
    }
  }
  for (const language of Object.keys(stopwordLists)) {
    scores.set(language, (scores.get(language) ?? 0) + distinctiveBonus(text, language));
  }
  const ranked: Array<[string, number]> = [...scores].sort(
    ([leftLanguage, left], [rightLanguage, right]) =>
      right - left || leftLanguage.localeCompare(rightLanguage),
  );
  const [leader, runnerUp] = ranked;
  if (leader === undefined || leader[1] < MIN_PROFILE_SCORE) {
    return undefined;
  }
  const confidence: number = (leader[1] - (runnerUp?.[1] ?? 0)) / leader[1];
  return confidence < MIN_CONFIDENCE ? undefined : { language: leader[0], confidence };
}

/** Script counts with Han and kana merged: one writing system here, which language comes after. */
function dominantScript(counts: Map<Script, number>): [Script | "cjk", number] {
  let dominant: [Script | "cjk", number] = [
    "cjk",
    (counts.get("han") ?? 0) + (counts.get("kana") ?? 0),
  ];
  for (const [script, letters] of counts) {
    if (script !== "han" && script !== "kana" && letters > dominant[1]) {
      dominant = [script, letters];
    }
  }
  return dominant;
}

/**
 * The language `text` is written in, or undefined when it is too short, too mixed, or written in a
 * language the profiles do not cover.
 */
export function detectLanguage(text: string): DetectedLanguage | undefined {
  const cleaned: string = cleanedText(text);
  const { counts, total } = letterCountsByScript(cleaned);
  const [dominant, dominantLetters] = dominantScript(counts);
  const share: number = total === 0 ? 0 : dominantLetters / total;
  if (share < DOMINANT_SCRIPT_MIN_SHARE) {
    return undefined;
  }
  const entry: ScriptEntry | undefined = SCRIPTS.find((candidate) => candidate.script === dominant);
  const unspaced: boolean = dominant === "cjk" || (entry !== undefined && "unspaced" in entry);
  const words: string[] = cleaned.split(WORD_SEPARATOR_PATTERN).filter((word) => word.length > 0);
  const wordCount: number = unspaced
    ? dominantLetters / CHARACTERS_PER_UNSPACED_WORD
    : words.length;
  if (wordCount < MIN_WORDS) {
    return undefined;
  }
  if (dominant === "latin" || dominant === "cyrillic") {
    return profileLanguage(cleaned, words);
  }
  if (dominant === "cjk") {
    const kanaShare: number = (counts.get("kana") ?? 0) / dominantLetters;
    return { language: kanaShare >= JAPANESE_MIN_KANA_SHARE ? "ja" : "zh", confidence: share };
  }
  if (dominant === "arabic") {
    return { language: arabicScriptLanguage(cleaned), confidence: share };
  }
  const language: string | undefined =
    entry !== undefined && "language" in entry ? entry.language : undefined;
  return language === undefined ? undefined : { language, confidence: share };
}
