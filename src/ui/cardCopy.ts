import type { ReasonStrength } from "@/src/core/scoring/strength";
import type { ReasonDirection } from "@/src/core/types";

/** Fixed hover-card copy that the wording-rule test checks alongside the core templates. */

const LEAN_TARGETS: Readonly<Record<ReasonDirection, string>> = {
  automated: "towards automated",
  ordinary: "towards ordinary",
};

const STRENGTH_LABELS: Readonly<Record<ReasonStrength, string>> = {
  weak: "Weak",
  moderate: "Moderate",
  strong: "Strong",
};

/**
 * The marker's one accessible name for its bar and its arrow together: "Strong, points towards
 * automated", or "Points towards automated" for a reason with no strength (the declared disclosure).
 */
export function markerLabel(
  direction: ReasonDirection,
  strength: ReasonStrength | undefined,
): string {
  if (strength === undefined) {
    return `Points ${LEAN_TARGETS[direction]}`;
  }
  return `${STRENGTH_LABELS[strength]}, points ${LEAN_TARGETS[direction]}`;
}

/**
 * The one control under the reasons that shows or hides every why clause (ADR-0023), worded by
 * how many clauses it reveals, not how many rows the card lists.
 */
export function whyToggleLabel(explainedCount: number, whyShown: boolean): string {
  const plural: boolean = explainedCount > 1;
  if (whyShown) {
    return plural ? "Hide explanations" : "Hide explanation";
  }
  return plural ? "What these mean" : "What this means";
}

export function cardFixedStrings(): string[] {
  const directions: ReasonDirection[] = ["automated", "ordinary"];
  const strengths: (ReasonStrength | undefined)[] = [undefined, "weak", "moderate", "strong"];
  return [
    ...directions.flatMap((direction: ReasonDirection) =>
      strengths.map((strength: ReasonStrength | undefined) => markerLabel(direction, strength)),
    ),
    ...[1, 2].flatMap((explainedCount: number) => [
      whyToggleLabel(explainedCount, false),
      whyToggleLabel(explainedCount, true),
    ]),
  ];
}
