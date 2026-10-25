/**
 * Self-descriptions of automation that the platform does not turn into a label: a username whose
 * last word is "bot", a flair that ends in "bot", a bio that says "I am a bot". Each is the account
 * or its community describing itself, which is why it reaches the declared tier like a platform
 * label does, and why every match is strict: a surname such as Talbot, a word such as "botanist" or
 * a "BotHunter" must never count. See docs/scoring-spec.md ("Declared automation").
 */

/** Reddit's site-wide moderation account: no label, and no "bot" in its name. */
const KNOWN_AUTOMATION_NAMES: ReadonlySet<string> = new Set(["automoderator"]);

const AUTOMATION_WORDS: ReadonlySet<string> = new Set(["bot", "bots"]);
const CAMEL_CASE_BOUNDARY = /([a-z])([A-Z])/g;
const NON_LETTERS = /[^a-z]+/;
/** "I am a bot", "I'm a GPT-2 bot", "This account is a reply bot". Up to three words may sit between. */
const BIO_DECLARATION = /\b(?:i am|i'm|this(?: account)? is)\s+an?\s+(?:[\w-]+\s+){0,3}bot\b/i;

/** Words of a name or phrase: camelCase, separators and digits all split, lowercased. */
function words(text: string): string[] {
  return text
    .replace(CAMEL_CASE_BOUNDARY, "$1 $2")
    .toLowerCase()
    .split(NON_LETTERS)
    .filter((word) => word.length > 0);
}

function lastWordIsAutomation(text: string): boolean {
  const last: string | undefined = words(text).at(-1);
  return last !== undefined && AUTOMATION_WORDS.has(last);
}

/** "RemindMeBot", "haiku_bot", "GPT2Bot", "Mistral_Bot_2" and AutoModerator; not Talbot or BotHunter. */
export function isSelfDescribedBotName(name: string): boolean {
  return KNOWN_AUTOMATION_NAMES.has(name.toLowerCase()) || lastWordIsAutomation(name);
}

/** A flair such as "Verified GPT-2 Bot"; "Bot Developer" does not count. */
export function flairDeclaresAutomation(flair: string): boolean {
  return lastWordIsAutomation(flair) || BIO_DECLARATION.test(flair);
}

/** A bio that says the account is a bot in so many words; "bot hunter" does not count. */
export function bioDeclaresAutomation(bio: string): boolean {
  return BIO_DECLARATION.test(bio);
}
