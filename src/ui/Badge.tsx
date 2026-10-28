import type { BadgeDensity } from "@/src/core/types";
import { Glyph } from "./Glyph";
import { accessibleLabel, glyphFor, visibleLabel, type BadgeTier, type LabelStyle } from "./labels";

export interface BadgeProps {
  tier: BadgeTier;
  labelStyle: LabelStyle;
  density: BadgeDensity;
  /** Hollow outline: fewer than half the data sources delivered. */
  lowConfidence: boolean;
  /** Dashed outline: lookups are paused by policy or conservative mode. */
  paused: boolean;
  /** A Tier 2 lookup for this account is running: the glyph pulses, and No read reads "Checking". */
  loading: boolean;
  /**
   * Holds the glyph still and dimmed while loading instead of pulsing. Reddit looks every author up
   * on sight, and dozens of pulsing badges at once dropped frames while scrolling on a 4x-throttled
   * CPU; only the badge under the pointer pulses there.
   */
  stillWhileLoading?: boolean;
  /** Reddit comment rows show the glyph alone unless the user asked for labels. */
  glyphOnlyAtCommentDensity: boolean;
  describedBy?: string;
  onOpen: () => void;
  onClose: () => void;
}

const TIER_CLASS: Record<BadgeTier, string> = {
  many: "bd-badge--many",
  some: "bd-badge--some",
  declared: "bd-badge--declared",
  typical: "bd-badge--human",
  unknown: "bd-badge--unknown",
};

const DENSITY_CLASS: Record<BadgeDensity, string> = {
  x: "",
  bluesky: "",
  "reddit-post": "bd-badge--reddit-post",
  "reddit-comment": "bd-badge--reddit-comment",
  hackernews: "bd-badge--hackernews",
  youtube: "bd-badge--youtube",
};

export function Badge(props: BadgeProps) {
  const glyphOnly =
    props.labelStyle === "icon" ||
    (props.density === "reddit-comment" && props.glyphOnlyAtCommentDensity);
  const text = glyphOnly ? null : visibleLabel(props.tier, props.labelStyle, props.loading);
  const classes = [
    "bd-badge",
    TIER_CLASS[props.tier],
    DENSITY_CLASS[props.density],
    props.lowConfidence ? "bd-badge--hollow" : "",
    props.paused ? "bd-badge--paused" : "",
    props.loading ? "bd-badge--loading" : "",
    props.loading && props.stillWhileLoading === true ? "bd-badge--loading-still" : "",
    text === null ? "bd-badge--glyph-only" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      class={classes}
      aria-label={accessibleLabel(props.tier, props.loading)}
      aria-describedby={props.describedBy}
      onMouseEnter={props.onOpen}
      onMouseLeave={props.onClose}
      onFocus={props.onOpen}
      onBlur={props.onClose}
    >
      <Glyph name={glyphFor(props.tier)} />
      {text}
    </button>
  );
}
