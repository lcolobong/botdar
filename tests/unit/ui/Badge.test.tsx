// @vitest-environment happy-dom
import { render } from "preact";
import { Badge, type BadgeProps } from "@/src/ui/Badge";

/** The visible label is the badge's own text; the unsure glyph carries a "?" inside its SVG. */
function labelText(button: HTMLButtonElement): string {
  return Array.from(button.childNodes)
    .filter((node: ChildNode) => node.nodeType === Node.TEXT_NODE)
    .map((node: ChildNode) => node.textContent ?? "")
    .join("");
}

function mount(overrides: Partial<BadgeProps> = {}): HTMLButtonElement {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  const props: BadgeProps = {
    tier: "many",
    labelStyle: "plain",
    density: "x",
    lowConfidence: false,
    paused: false,
    loading: false,
    glyphOnlyAtCommentDensity: true,
    onOpen: () => {},
    onClose: () => {},
    ...overrides,
  };
  render(<Badge {...props} />, container);
  const button: HTMLButtonElement | null = container.querySelector("button");
  if (!button) throw new Error("badge did not render a button");
  return button;
}

describe("Badge", () => {
  it("renders the plain label, tier class and accessible name", () => {
    const button: HTMLButtonElement = mount();
    expect(labelText(button)).toBe("Likely bot");
    expect(button.className).toContain("bd-badge--many");
    expect(button.getAttribute("aria-label")).toBe("Likely bot");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("uses sus wording without changing the accessible name", () => {
    const button: HTMLButtonElement = mount({ tier: "some", labelStyle: "sus" });
    expect(labelText(button)).toBe("Kinda sus");
    expect(button.getAttribute("aria-label")).toBe("Unsure");
  });

  it("drops the text in icon style and at Reddit comment density", () => {
    expect(labelText(mount({ labelStyle: "icon" }))).toBe("");
    expect(mount({ density: "reddit-comment" }).className).toContain("bd-badge--glyph-only");
    expect(labelText(mount({ density: "reddit-comment", glyphOnlyAtCommentDensity: false }))).toBe(
      "Likely bot",
    );
  });

  it("draws No read as a neutral question-mark badge", () => {
    const button: HTMLButtonElement = mount({ tier: "unknown", lowConfidence: true });
    expect(labelText(button)).toBe("No read");
    expect(button.getAttribute("aria-label")).toBe("No read");
    expect(button.className).toContain("bd-badge--unknown");
    expect(button.className).toContain("bd-badge--hollow");
    expect(button.querySelector("svg circle")).not.toBeNull();
  });

  it("reads Checking with a pulsing glyph while an unknown account's lookup runs", () => {
    const button: HTMLButtonElement = mount({ tier: "unknown", loading: true });
    expect(labelText(button)).toBe("Checking");
    expect(button.getAttribute("aria-label")).toBe("Checking");
    expect(button.className).toContain("bd-badge--loading");
  });

  it("adds the hollow, paused and loading state classes", () => {
    const button: HTMLButtonElement = mount({ lowConfidence: true, paused: true, loading: true });
    expect(button.className).toContain("bd-badge--hollow");
    expect(button.className).toContain("bd-badge--paused");
    expect(button.className).toContain("bd-badge--loading");
  });
});
