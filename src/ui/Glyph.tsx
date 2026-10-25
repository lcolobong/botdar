import type { Glyph as GlyphName } from "./labels";

interface GlyphProps {
  name: GlyphName;
}

/** Inline SVG glyphs from the design system; fills follow currentColor, the bot's eyes use --bot-eye. */
export function Glyph({ name }: GlyphProps) {
  switch (name) {
    case "bot":
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" class="bd-glyph">
          <rect x="1.5" y="3" width="9" height="7.5" rx="2" fill="currentColor" />
          <rect x="5.5" y="0.8" width="1" height="2.4" fill="currentColor" />
          <circle cx="6" cy="0.9" r="0.9" fill="currentColor" />
          <circle cx="4.2" cy="6.6" r="1.3" class="bd-eye" />
          <circle cx="7.8" cy="6.6" r="1.3" class="bd-eye" />
        </svg>
      );
    case "unsure":
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" class="bd-glyph">
          <rect
            x="1.5"
            y="3"
            width="9"
            height="7.5"
            rx="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <rect x="5.5" y="0.8" width="1" height="2.4" fill="currentColor" />
          <text
            x="6"
            y="9.2"
            text-anchor="middle"
            font-size="6.5"
            font-weight="700"
            font-family="sans-serif"
            fill="currentColor"
          >
            ?
          </text>
        </svg>
      );
    case "tag":
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" class="bd-glyph">
          <path d="M1.5 1.5h5l4 4-5 5-4-4z" fill="currentColor" />
          <circle cx="4" cy="4" r="1" fill="#ffffff" fill-opacity="0.8" />
        </svg>
      );
    case "question":
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" class="bd-glyph">
          <circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" stroke-width="1.2" />
          <text
            x="6"
            y="8.4"
            text-anchor="middle"
            font-size="7"
            font-weight="700"
            font-family="sans-serif"
            fill="currentColor"
          >
            ?
          </text>
        </svg>
      );
    case "person":
      return (
        <svg viewBox="0 0 12 12" aria-hidden="true" class="bd-glyph">
          <circle cx="6" cy="3.6" r="2.3" fill="currentColor" />
          <path d="M1.5 11c0-2.6 2-4.2 4.5-4.2S10.5 8.4 10.5 11z" fill="currentColor" />
        </svg>
      );
  }
}
