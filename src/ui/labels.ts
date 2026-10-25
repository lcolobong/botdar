import type { VerdictTier } from "@/src/core/types";

/** Mirrors Settings.labelStyle; kept here so the UI package does not depend on the settings module. */
export type LabelStyle = "plain" | "sus" | "icon";

/** Every verdict tier has a badge (ADR-0020); "typical" only while "Show Likely human" is on. */
export type BadgeTier = VerdictTier;

export type Glyph = "bot" | "unsure" | "tag" | "person" | "question";

interface TierLabels {
  plain: string;
  sus: string;
  glyph: Glyph;
}

/** Fixed badge wording per ADR-0017 and ADR-0020; the plain string is always the accessible name. */
const LABELS: Record<BadgeTier, TierLabels> = {
  many: { plain: "Likely bot", sus: "Sus", glyph: "bot" },
  some: { plain: "Unsure", sus: "Kinda sus", glyph: "unsure" },
  declared: { plain: "Declared bot", sus: "Honest self-report bot", glyph: "tag" },
  typical: { plain: "Likely human", sus: "Real af", glyph: "person" },
  unknown: { plain: "No read", sus: "Who dis", glyph: "question" },
};

/**
 * An unknown verdict whose lookup is still running is not a "No read" yet. The other tiers keep
 * their label while loading, since the lookup can only refine a read that already exists.
 */
const CHECKING_LABEL = "Checking";

function isChecking(tier: BadgeTier, loading: boolean): boolean {
  return loading && tier === "unknown";
}

export function accessibleLabel(tier: BadgeTier, loading = false): string {
  return isChecking(tier, loading) ? CHECKING_LABEL : LABELS[tier].plain;
}

/** The visible text for a badge, or null when the style shows the glyph alone. */
export function visibleLabel(tier: BadgeTier, style: LabelStyle, loading = false): string | null {
  if (style === "icon") return null;
  return isChecking(tier, loading) ? CHECKING_LABEL : LABELS[tier][style];
}

export function glyphFor(tier: BadgeTier): Glyph {
  return LABELS[tier].glyph;
}

/** Whether a verdict tier draws a badge under the current settings: all but a hidden Likely human. */
export function shouldDrawBadge(tier: VerdictTier, showLikelyHuman: boolean): boolean {
  return tier !== "typical" || showLikelyHuman;
}
