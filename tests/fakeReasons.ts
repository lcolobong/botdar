import type { SourceTier, Verdict, VerdictReason } from "@/src/core/types";

/** A verdict reason for fake scorers, where only the wording and source tier matter. */
export function fakeReason(text: string, tier: SourceTier = 0): VerdictReason {
  return { text, why: `why:${text}`, direction: "automated", contribution: 1, tier };
}

/** The wording of a verdict's reasons, for assertions that only care what the card says. */
export function reasonTexts(verdict: Pick<Verdict, "reasons">): string[] {
  return verdict.reasons.map((reason: VerdictReason) => reason.text);
}
