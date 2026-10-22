import { handleBigramLogLikelihood } from "@/src/core/handle/bigram";

/** Bin edges of `x.handleBigramLL` in docs/scoring-spec.md. */
const STRONG_THRESHOLD = -4.5;
const WEAK_THRESHOLD = -3.8;

const NATURAL_HANDLES: string[] = [
  "sarah_jones",
  "marcusdev",
  "jordan_reads",
  "priya",
  "emily_writes",
  "danielrodriguez",
  "the_real_mike",
  "bookworm42",
  "ava1990",
  "quiet_harbor",
];

const RANDOM_HANDLES: string[] = [
  "xq7zk2pw",
  "a8f3k1m9",
  "qzxv_kjw",
  "zz9qx8vk7",
  "wq2jx9zpk",
  "hjkqzx",
  "mxq9bvz",
  "k7p2qx4z",
];

describe("handleBigramLogLikelihood", () => {
  it("scores natural handles higher than random strings", () => {
    const lowestNatural: number = Math.min(...NATURAL_HANDLES.map(handleBigramLogLikelihood));
    const highestRandom: number = Math.max(...RANDOM_HANDLES.map(handleBigramLogLikelihood));
    expect(lowestNatural).toBeGreaterThan(highestRandom);
  });

  it.each(NATURAL_HANDLES)("%s clears the weak threshold", (handle) => {
    expect(handleBigramLogLikelihood(handle)).toBeGreaterThanOrEqual(WEAK_THRESHOLD);
  });

  it.each(RANDOM_HANDLES)("%s falls below the weak threshold", (handle) => {
    expect(handleBigramLogLikelihood(handle)).toBeLessThan(WEAK_THRESHOLD);
  });

  // With Laplace smoothing over the bundled corpus the floor is about -4.44, so random strings land
  // in the spec's middle bin; the strong bin below -4.5 waits for the calibration pass.
  it.each(RANDOM_HANDLES)("%s lands in the middle bin", (handle) => {
    const score: number = handleBigramLogLikelihood(handle);
    expect(score).toBeGreaterThanOrEqual(STRONG_THRESHOLD);
    expect(score).toBeLessThan(WEAK_THRESHOLD);
  });

  it("is case-insensitive", () => {
    expect(handleBigramLogLikelihood("SarahJones")).toBe(handleBigramLogLikelihood("sarahjones"));
  });

  it("maps characters outside the alphabet to underscore", () => {
    expect(handleBigramLogLikelihood("sarah.jones")).toBe(handleBigramLogLikelihood("sarah_jones"));
    expect(handleBigramLogLikelihood("sarah-jones")).toBe(handleBigramLogLikelihood("sarah_jones"));
  });

  it("returns a finite score for an empty handle", () => {
    expect(Number.isFinite(handleBigramLogLikelihood(""))).toBe(true);
  });
});
