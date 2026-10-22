import type { VerdictTier } from "@/src/core/types";

/** Mirrors Settings.labelStyle; kept here so the UI package does not depend on the settings module. */
export type LabelStyle = "plain" | "sus" | "icon";

/** Tiers that draw a badge. "typical" only when the user turned "Show Likely human" on; "unknown" never. */
export type BadgeTier = Exclude<VerdictTier, "unknown">;

export type Glyph = "bot" | "unsure" | "tag" | "person";

interface TierLabels {
  plain: string;
  sus: string;
  glyph: Glyph;
}

/** Fixed badge wording per ADR-0017; the plain string is always the accessible name. */
const LABELS: Record<BadgeTier, TierLabels> = {
  many: { plain: "Likely bot", sus: "Sus", glyph: "bot" },
  some: { plain: "Unsure", sus: "Kinda sus", glyph: "unsure" },
  declared: { plain: "Declared bot", sus: "Honest self-report bot", glyph: "tag" },
  typical: { plain: "Likely human", sus: "Real af", glyph: "person" },
};

export function accessibleLabel(tier: BadgeTier): string {
  return LABELS[tier].plain;
}

/** The visible text for a badge, or null when the style shows the glyph alone. */
export function visibleLabel(tier: BadgeTier, style: LabelStyle): string | null {
  if (style === "icon") return null;
  return LABELS[tier][style];
}

export function glyphFor(tier: BadgeTier): Glyph {
  return LABELS[tier].glyph;
}

/** Whether a verdict tier draws a badge at all under the current settings. */
export function shouldDrawBadge(tier: VerdictTier, showLikelyHuman: boolean): tier is BadgeTier {
  if (tier === "unknown") return false;
  if (tier === "typical") return showLikelyHuman;
  return true;
}
