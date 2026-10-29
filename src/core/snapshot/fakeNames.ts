/**
 * Word lists for stable fake handles, shared by the fixture anonymizer and the perf fixture
 * generator so recordings and generated pages read the same way. The handle rules live in
 * ../handleRules.ts.
 */

/** A name and then five or more digits ("maria48213907"), the shape the "nameDigits" fake keeps. */
export const NAME_THEN_DIGITS: RegExp = /^[A-Za-z]+\d{5,}$/;

export const FAKE_ADJECTIVES: readonly string[] = [
  "Quiet",
  "Brisk",
  "Mossy",
  "Amber",
  "Lucky",
  "Rapid",
];
export const FAKE_NOUNS: readonly string[] = [
  "Lantern",
  "Falcon",
  "Teapot",
  "Badger",
  "Willow",
  "Comet",
];
export const FAKE_FIRST_NAMES: readonly string[] = [
  "alice",
  "maria",
  "jonas",
  "priya",
  "tomas",
  "lena",
  "omar",
];
export const FAKE_TOPICS: readonly string[] = [
  "reads",
  "builds",
  "codes",
  "bakes",
  "runs",
  "draws",
  "sails",
];

/** FNV-1a over the UTF-16 code units: small, dependency-free and stable across runs and machines. */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function pickBy(hash: number, shift: number, list: readonly string[]): string {
  return list[(hash >>> shift) % list.length] as string;
}

function digitsBy(hash: number, count: number): string {
  return String(hash % 10 ** count).padStart(count, "0");
}

/**
 * A fake username that keeps the shape the scoring features read: a platform-generated name stays
 * generated-looking, a name-plus-many-digits handle keeps its digit run, and anything else becomes
 * an ordinary word pair with at most two digits. Without this a recording would score every account
 * the same way the fake's shape scores, not the way the real account did. `attempt` picks the next
 * candidate when an earlier one is already taken by another handle (see `distinctFakes`).
 */
export function fakeHandle(
  original: string,
  shape: "generated" | "nameDigits" | "plain",
  attempt = 0,
): string {
  const lowercase: string = original.toLowerCase();
  const hash: number = stableHash(attempt === 0 ? lowercase : `${lowercase}#${attempt}`);
  switch (shape) {
    case "generated":
      return `${pickBy(hash, 0, FAKE_ADJECTIVES)}_${pickBy(hash, 8, FAKE_NOUNS)}_${digitsBy(hash, 4)}`;
    case "nameDigits":
      return `${pickBy(hash, 0, FAKE_FIRST_NAMES)}${digitsBy(hash, 8)}`;
    case "plain":
      return `${pickBy(hash, 0, FAKE_FIRST_NAMES)}_${pickBy(hash, 8, FAKE_TOPICS)}${digitsBy(hash, 2)}`;
  }
}

/** A lowercase base-36 stand-in for an opaque id, the same length as the original. */
export function fakeId(original: string, length: number = original.length): string {
  let output = "";
  let seed: number = stableHash(original);
  while (output.length < length) {
    output += seed.toString(36);
    seed = stableHash(`${original}:${output.length}`);
  }
  return output.slice(0, length);
}

/** A decimal stand-in for a numeric id, the same length as the original. */
export function fakeDigits(original: string, attempt = 0): string {
  let output = "";
  for (let round = 0; output.length < original.length; round += 1) {
    output += String(stableHash(`${original}#${attempt}:${round}`)).padStart(10, "0");
  }
  return output.slice(0, original.length);
}

/**
 * One fake per account, never the same fake for two accounts in one snapshot: a word pair plus two
 * digits has a few thousand values, so a page of sixty authors collides often enough to merge two
 * of them in a test. Handles are visited in sorted order and a taken fake moves to the next
 * attempt, so a handle that collides with nothing keeps the fake it gets in every recording.
 * `accountOf` says which spellings are one account (lowercased where the platform ignores case).
 */
export function distinctFakes(
  handles: Iterable<string>,
  fakeOf: (handle: string, attempt: number) => string,
  accountOf: (handle: string) => string,
): Map<string, string> {
  const fakeByAccount: Map<string, string> = new Map();
  const taken: Set<string> = new Set();
  const fakes: Map<string, string> = new Map();
  for (const handle of [...new Set(handles)].sort()) {
    const account: string = accountOf(handle);
    let fake: string | undefined = fakeByAccount.get(account);
    for (let attempt = 0; fake === undefined; attempt += 1) {
      const candidate: string = fakeOf(handle, attempt);
      if (!taken.has(accountOf(candidate))) fake = candidate;
    }
    fakeByAccount.set(account, fake);
    taken.add(accountOf(fake));
    fakes.set(handle, fake);
  }
  return fakes;
}

/** Fake numeric ids that stay distinct within one snapshot, the same id always getting the same fake. */
export function distinctDigits(): (id: string) => string {
  const fakeById: Map<string, string> = new Map();
  const taken: Set<string> = new Set();
  return (id) => {
    const known: string | undefined = fakeById.get(id);
    if (known !== undefined) return known;
    let fake: string = fakeDigits(id);
    for (let attempt = 1; taken.has(fake) || fake === id; attempt += 1) {
      fake = fakeDigits(id, attempt);
    }
    fakeById.set(id, fake);
    taken.add(fake);
    return fake;
  };
}
