/**
 * Builds src/core/handle/bigrams.json: a character-bigram log-likelihood table for the handle scorer,
 * in the spirit of BotometerLite's screen_name_likelihood (docs/research/heuristics.md).
 *
 * Run: pnpm bigrams:build
 *
 * Each token in scripts/data/handle-corpus.txt is wrapped in boundary symbols and every adjacent pair
 * is counted. The table holds the joint probability of each pair over the whole corpus (not the
 * probability conditional on the first character), smoothed additively so unseen pairs get a floor
 * instead of -Infinity. Joint probabilities keep the floor low enough that handles made of unseen
 * pairs land well below the thresholds in docs/scoring-spec.md.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789_";
const BOUNDARY = "|";
const SMOOTHING_PSEUDOCOUNT = 1;
const LOG_PROBABILITY_DECIMALS = 3;

const CORPUS_PATH: string = resolve(import.meta.dirname, "data/handle-corpus.txt");
const OUTPUT_PATH: string = resolve(import.meta.dirname, "../src/core/handle/bigrams.json");

interface BigramTable {
  meta: {
    alphabet: string;
    boundary: string;
    corpusTokens: number;
    bigramInstances: number;
    smoothing: string;
    builtAt: string;
  };
  /** log10 joint probability of each two-symbol string over the alphabet plus the boundary. */
  logProbabilities: Record<string, number>;
}

function readCorpusTokens(path: string): string[] {
  const allowed: Set<string> = new Set(ALPHABET);
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((token) => token.length > 0)
    .map((token) =>
      Array.from(token, (character) => (allowed.has(character) ? character : "_")).join(""),
    );
}

function countBigrams(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    const bounded: string = BOUNDARY + token + BOUNDARY;
    for (let index = 0; index < bounded.length - 1; index += 1) {
      const bigram: string = bounded.slice(index, index + 2);
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
    }
  }
  return counts;
}

function buildTable(tokens: string[]): BigramTable {
  const symbols: string[] = [...ALPHABET, BOUNDARY];
  const counts: Map<string, number> = countBigrams(tokens);
  const bigramInstances: number = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const vocabularySize: number = symbols.length * symbols.length;
  const smoothedTotal: number = bigramInstances + SMOOTHING_PSEUDOCOUNT * vocabularySize;
  const rounding: number = 10 ** LOG_PROBABILITY_DECIMALS;

  const logProbabilities: Record<string, number> = {};
  for (const first of symbols) {
    for (const second of symbols) {
      const bigram: string = first + second;
      const smoothedCount: number = (counts.get(bigram) ?? 0) + SMOOTHING_PSEUDOCOUNT;
      const logProbability: number = Math.log10(smoothedCount / smoothedTotal);
      logProbabilities[bigram] = Math.round(logProbability * rounding) / rounding;
    }
  }

  return {
    meta: {
      alphabet: ALPHABET,
      boundary: BOUNDARY,
      corpusTokens: tokens.length,
      bigramInstances,
      smoothing: `additive, pseudocount ${SMOOTHING_PSEUDOCOUNT}`,
      builtAt: new Date().toISOString(),
    },
    logProbabilities,
  };
}

const tokens: string[] = readCorpusTokens(CORPUS_PATH);
const table: BigramTable = buildTable(tokens);
writeFileSync(OUTPUT_PATH, `${JSON.stringify(table, null, 2)}\n`);
console.warn(
  `Wrote ${OUTPUT_PATH}: ${tokens.length} tokens, ${table.meta.bigramInstances} bigram instances`,
);
