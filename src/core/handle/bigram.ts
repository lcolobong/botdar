/**
 * Character-bigram likelihood of a handle, after BotometerLite's screen_name_likelihood
 * (docs/research/heuristics.md). The table comes from scripts/build-bigrams.ts.
 */

import bigramTable from "./bigrams.json" with { type: "json" };

const { alphabet, boundary } = bigramTable.meta;
const logProbabilities: Record<string, number> = bigramTable.logProbabilities;

const alphabetCharacters: Set<string> = new Set(alphabet);

/** The smoothed floor every unseen pair shares; only reached if the table were ever truncated. */
const unseenLogProbability: number = Math.min(...Object.values(logProbabilities));

function toAlphabet(handle: string): string {
  return Array.from(handle.toLowerCase(), (character) =>
    alphabetCharacters.has(character) ? character : "_",
  ).join("");
}

/**
 * Mean log10 probability of the handle's character bigrams, boundaries included: the log of the
 * geometric mean. Natural handles land around -2.5 to -3.1; random strings fall below -3.8
 * (see docs/scoring-spec.md, `x.handleBigramLL`).
 */
export function handleBigramLogLikelihood(handle: string): number {
  const bounded: string = boundary + toAlphabet(handle) + boundary;
  const bigramCount: number = bounded.length - 1;
  let sum = 0;
  for (let index = 0; index < bigramCount; index += 1) {
    sum += logProbabilities[bounded.slice(index, index + 2)] ?? unseenLogProbability;
  }
  return sum / bigramCount;
}
