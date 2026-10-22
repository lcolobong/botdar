/** The product mark from the design system: a disc inside two concentric rings, drawn in brand. */
export function Mark() {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="1.2" fill="currentColor" />
      <circle cx="4" cy="4" r="2.5" fill="none" stroke="currentColor" stroke-width="0.8" />
      <circle cx="4" cy="4" r="3.6" fill="none" stroke="currentColor" stroke-width="0.8" />
    </svg>
  );
}
