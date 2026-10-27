/**
 * Text comparison for near-duplicate replies (docs/scoring-spec.md, "Near-duplicate replies";
 * ADR-0027). A reply is reduced to the set of distinct words it uses once case, URLs, mentions,
 * punctuation and emoji are gone, and two replies are compared by the Jaccard similarity of those
 * sets. Single words rather than word shingles: the cheap edits an operator makes to a template (one
 * swapped word, an added hashtag, a reordered clause) leave most words in place but break most
 * shingles, while two unrelated replies of six words or more rarely share 70% of their vocabulary.
 */

/** A reply this short after normalising is a greeting, a slogan or a meme line: never compared. */
export const MIN_COMPARABLE_LENGTH = 40;
export const MIN_COMPARABLE_WORDS = 6;
/** Jaccard similarity of the two word sets from which replies count as copies of each other. */
export const NEAR_DUPLICATE_MIN_SIMILARITY = 0.7;

const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/giu;
/** "@name" on X and Bluesky (whose handles are domains, dots included), "u/name" on Reddit. */
const MENTION_PATTERN = /(?<![\p{L}\p{N}])(?:@|\/?u\/)[\p{L}\p{N}_.-]+/gu;
/**
 * An apostrophe between two letters joins a contraction ("don't", "it’s") into one word; the
 * punctuation pass would split it in two and let a short line of contractions pass the word gate.
 */
const INNER_APOSTROPHE_PATTERN = /(?<=[\p{L}\p{N}])['’](?=[\p{L}\p{N}])/gu;
/** Punctuation, symbols and emoji, everything that is neither a letter, a digit nor a space. */
const NON_WORD_PATTERN = /[^\p{L}\p{N}\s]+/gu;
const WHITESPACE_PATTERN = /\s+/gu;
// eslint-disable-next-line no-control-regex -- the range is the whole of ASCII, controls included.
const ASCII_ONLY_PATTERN = /^[\u0000-\u007f]*$/;

/**
 * Lowercased, with URLs, mentions and punctuation removed and whitespace runs collapsed. NFKC first,
 * so full-width and mathematical-alphabet letters, a cheap way to dodge an exact match, fold to
 * plain ones.
 */
export function normaliseReplyText(text: string): string {
  // Every reply on a page is normalised when it is discovered; plain ASCII has nothing to fold.
  const foldedText: string = ASCII_ONLY_PATTERN.test(text) ? text : text.normalize("NFKC");
  return foldedText
    .toLowerCase()
    .replace(URL_PATTERN, " ")
    .replace(MENTION_PATTERN, " ")
    .replace(INNER_APOSTROPHE_PATTERN, "")
    .replace(NON_WORD_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

/**
 * The distinct words of a reply long enough to compare, or undefined for a shorter one. Text with no
 * spaces between words (Chinese, Japanese, Thai) normalises to a few long "words" and so never
 * clears the word minimum: the feature stays silent there rather than guessing at segmentation.
 */
export function comparableWords(text: string): ReadonlySet<string> | undefined {
  const normalisedText: string = normaliseReplyText(text);
  if (normalisedText.length < MIN_COMPARABLE_LENGTH) {
    return undefined;
  }
  const words: string[] = normalisedText.split(" ");
  return words.length < MIN_COMPARABLE_WORDS ? undefined : new Set(words);
}

/** |A ∩ B| / |A ∪ B|; 0 for two empty sets. */
export function wordSetSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let sharedCount = 0;
  for (const word of smaller) {
    if (larger.has(word)) {
      sharedCount += 1;
    }
  }
  const unionSize: number = left.size + right.size - sharedCount;
  return unionSize === 0 ? 0 : sharedCount / unionSize;
}

/**
 * Whether two word sets are similar enough to count as copies. The similarity can never exceed the
 * ratio of the two sizes, so a pair too different in length is ruled out before any word is looked
 * up; a long thread makes this comparison thousands of times.
 */
export function areNearDuplicates(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  const smallerSize: number = Math.min(left.size, right.size);
  const largerSize: number = Math.max(left.size, right.size);
  if (smallerSize < NEAR_DUPLICATE_MIN_SIMILARITY * largerSize) {
    return false;
  }
  return wordSetSimilarity(left, right) >= NEAR_DUPLICATE_MIN_SIMILARITY;
}
