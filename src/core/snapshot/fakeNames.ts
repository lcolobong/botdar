/**
 * Word lists for stable fake handles, shared by the fixture anonymizer and the perf fixture
 * generator so recordings and generated pages read the same way.
 */
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
 * the same way the fake's shape scores, not the way the real account did.
 */
export function fakeHandle(original: string, shape: "generated" | "nameDigits" | "plain"): string {
  const hash: number = stableHash(original.toLowerCase());
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
