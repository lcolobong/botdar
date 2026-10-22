// @vitest-environment happy-dom
import { render } from "preact";
import { Segmented, type SegmentedProps } from "@/src/ui/controls/Segmented";

type Style = "plain" | "sus" | "icon";

const OPTIONS: SegmentedProps<Style>["options"] = [
  { value: "plain", label: "Plain" },
  { value: "sus", label: "Sus scale" },
  { value: "icon", label: "Icon only" },
];

function mount(overrides: Partial<SegmentedProps<Style>> = {}): HTMLDivElement {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  const props: SegmentedProps<Style> = {
    label: "Label style",
    options: OPTIONS,
    value: "plain",
    onChange: () => {},
    ...overrides,
  };
  render(<Segmented {...props} />, container);
  const group: HTMLDivElement | null = container.querySelector("div[role=group]");
  if (!group) throw new Error("segmented did not render a group");
  return group;
}

const buttonsOf = (group: HTMLElement): HTMLButtonElement[] =>
  Array.from(group.querySelectorAll("button"));

describe("Segmented", () => {
  it("renders one pressed button per option under a named group", () => {
    const group: HTMLDivElement = mount({ value: "sus" });
    expect(group.getAttribute("aria-label")).toBe("Label style");
    const buttons: HTMLButtonElement[] = buttonsOf(group);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Plain",
      "Sus scale",
      "Icon only",
    ]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  });

  it("selects the clicked option", () => {
    const onChange = vi.fn();
    const buttons: HTMLButtonElement[] = buttonsOf(mount({ onChange }));
    buttons[2]?.click();
    expect(onChange).toHaveBeenCalledWith("icon");
  });

  it("moves the selection and the focus with the arrow keys, wrapping at the ends", () => {
    const onChange = vi.fn();
    const group: HTMLDivElement = mount({ value: "icon", onChange });
    const buttons: HTMLButtonElement[] = buttonsOf(group);
    buttons[2]?.focus();
    buttons[2]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith("plain");
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith("sus");
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("ignores other keys", () => {
    const onChange = vi.fn();
    const buttons: HTMLButtonElement[] = buttonsOf(mount({ onChange }));
    buttons[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
