import {
  MIN_COMPARABLE_LENGTH,
  areNearDuplicates,
  comparableWords,
  normaliseReplyText,
  wordSetSimilarity,
} from "@/src/core/text/replySimilarity";

const TEMPLATE = "This is exactly the kind of leadership our country needs right now, well said!";

function wordsOf(text: string): ReadonlySet<string> {
  const words: ReadonlySet<string> | undefined = comparableWords(text);
  if (words === undefined) {
    throw new Error(`not comparable: ${text}`);
  }
  return words;
}

describe("normaliseReplyText", () => {
  it("lowercases and drops punctuation, emoji and whitespace runs", () => {
    expect(normaliseReplyText("Well   SAID!!! 🔥🔥 Couldn't agree more…")).toBe(
      "well said couldnt agree more",
    );
  });

  it("keeps a contraction as one word, with either apostrophe", () => {
    expect(normaliseReplyText("Don't stop, it’s 'fine'")).toBe("dont stop its fine");
  });

  it("drops URLs", () => {
    expect(
      normaliseReplyText("Read this https://example.com/a?b=c and www.example.org/x now"),
    ).toBe("read this and now");
  });

  it("drops @mentions, Bluesky handles and Reddit u/ mentions, but not e-mail addresses", () => {
    expect(normaliseReplyText("@alice_1 hi @bob.bsky.social and u/Carol_2 or /u/dave")).toBe(
      "hi and or",
    );
    expect(normaliseReplyText("mail me@example.com")).toBe("mail me example com");
  });

  it("folds full-width and mathematical letters to plain ones", () => {
    expect(normaliseReplyText("Ｗｅｌｌ 𝐬𝐚𝐢𝐝")).toBe("well said");
  });

  it("keeps letters and digits of every script", () => {
    expect(normaliseReplyText("Отлично, 100% согласен!")).toBe("отлично 100 согласен");
  });
});

describe("comparableWords", () => {
  it("returns the distinct words of a long enough reply", () => {
    expect(comparableWords("the cat sat on the mat and then the cat slept all day")).toEqual(
      new Set(["the", "cat", "sat", "on", "mat", "and", "then", "slept", "all", "day"]),
    );
  });

  it("ignores replies shorter than the length gate", () => {
    const short = "Happy birthday to you my dear friend!";
    expect(normaliseReplyText(short).length).toBeLessThan(MIN_COMPARABLE_LENGTH);
    expect(comparableWords(short)).toBeUndefined();
  });

  it("ignores replies with fewer than six words however long", () => {
    expect(
      comparableWords("Congratulations incomprehensibilities extraordinarily wonderful"),
    ).toBeUndefined();
  });

  it("keeps a line of contractions under the word gate", () => {
    const contractions = "Wouldn't've, shouldn't've, couldn't've, mightn't've";
    expect(normaliseReplyText(contractions)).toBe("wouldntve shouldntve couldntve mightntve");
    expect(comparableWords(contractions)).toBeUndefined();
  });

  it("does not count a URL or a mention towards the gates", () => {
    expect(comparableWords("@somebody https://example.com/a/very/long/path/indeed ok")).toBe(
      undefined,
    );
  });

  it("stays silent on text without spaces between words", () => {
    expect(comparableWords("これは本当に素晴らしいリーダーシップだと思います、よく言った！")).toBe(
      undefined,
    );
  });
});

describe("wordSetSimilarity", () => {
  it("is the Jaccard similarity of the two sets", () => {
    expect(wordSetSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(0.5);
    expect(wordSetSimilarity(new Set(["a"]), new Set(["a"]))).toBe(1);
    expect(wordSetSimilarity(new Set(), new Set())).toBe(0);
  });
});

describe("areNearDuplicates", () => {
  it("matches a verbatim copy with different punctuation, case, mentions and links", () => {
    expect(
      areNearDuplicates(
        wordsOf(TEMPLATE),
        wordsOf(
          "@someone THIS is exactly the kind of leadership our country needs right now. Well said 👏 https://t.co/x",
        ),
      ),
    ).toBe(true);
  });

  it("matches a template with one word swapped", () => {
    expect(
      areNearDuplicates(
        wordsOf(TEMPLATE),
        wordsOf("This is exactly the kind of leadership our nation needs right now, well said!"),
      ),
    ).toBe(true);
  });

  it("does not match two replies on the same topic in different words", () => {
    expect(
      areNearDuplicates(
        wordsOf(TEMPLATE),
        wordsOf("Not sure this is leadership, it reads like a campaign speech to me honestly."),
      ),
    ).toBe(false);
  });

  it("does not match a reply that only repeats part of a longer one", () => {
    const short: ReadonlySet<string> = wordsOf("Thanks for sharing this, really useful thread");
    const long: ReadonlySet<string> = wordsOf(
      "Thanks for sharing this, really useful thread, I will try the walnut finish next weekend",
    );
    expect(areNearDuplicates(short, long)).toBe(false);
  });
});
