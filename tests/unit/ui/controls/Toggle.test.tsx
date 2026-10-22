// @vitest-environment happy-dom
import { render } from "preact";
import { Toggle, type ToggleProps } from "@/src/ui/controls/Toggle";

function mount(overrides: Partial<ToggleProps> = {}): HTMLButtonElement {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  const props: ToggleProps = { checked: false, label: "X", onChange: () => {}, ...overrides };
  render(<Toggle {...props} />, container);
  const button: HTMLButtonElement | null = container.querySelector("button");
  if (!button) throw new Error("toggle did not render a button");
  return button;
}

describe("Toggle", () => {
  it("is a switch with an accessible name and the checked state", () => {
    const button: HTMLButtonElement = mount({ checked: true, label: "Reddit" });
    expect(button.getAttribute("role")).toBe("switch");
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Reddit");
    expect(button.className).toBe("bd-toggle");
    expect(mount({ checked: false }).getAttribute("aria-checked")).toBe("false");
  });

  it("reports the flipped value on activation", () => {
    const onChange = vi.fn();
    mount({ checked: false, onChange }).click();
    mount({ checked: true, onChange }).click();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    const button: HTMLButtonElement = mount({ disabled: true, onChange });
    button.click();
    expect(button.disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
