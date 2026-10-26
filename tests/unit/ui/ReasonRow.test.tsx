// @vitest-environment happy-dom
import { render } from "preact";
import { ReasonRow, type CardReason } from "@/src/ui/ReasonRow";

function mountRow(reason: CardReason): HTMLElement {
  const list: HTMLUListElement = document.createElement("ul");
  document.body.append(list);
  render(<ReasonRow reason={reason} />, list);
  return list;
}

describe("ReasonRow", () => {
  it("shows the direction, the observation, its why clause and its source", () => {
    const row: HTMLElement = mountRow({
      text: "Joined 3 weeks ago",
      why: "new accounts often replace banned ones",
      direction: "automated",
      tier: 1,
    });
    const lean: Element | null = row.querySelector(".bd-card__lean");
    expect(lean?.textContent).toBe("↑");
    expect(lean?.getAttribute("role")).toBe("img");
    expect(lean?.getAttribute("aria-label")).toBe("Points towards automated");
    expect(row.querySelector(".bd-card__reason--automated")).not.toBeNull();
    expect(row.querySelector(".bd-card__fact")?.textContent).toBe("Joined 3 weeks ago");
    expect(row.querySelector(".bd-card__why")?.textContent).toBe(
      " · new accounts often replace banned ones",
    );
    expect(row.querySelector(".bd-dot--1")).not.toBeNull();
  });

  it("marks evidence that points towards an ordinary account with its own shape and label", () => {
    const row: HTMLElement = mountRow({
      text: "Account is 9 years old",
      why: "outlasted platform enforcement",
      direction: "ordinary",
      tier: 2,
    });
    const lean: Element | null = row.querySelector(".bd-card__lean");
    expect(lean?.textContent).toBe("↓");
    expect(lean?.getAttribute("aria-label")).toBe("Points towards ordinary");
    expect(row.querySelector(".bd-card__reason--ordinary")).not.toBeNull();
  });

  it("leaves out the separator when there is no why clause", () => {
    const row: HTMLElement = mountRow({
      text: "x.somethingNew",
      why: "",
      direction: "automated",
      tier: 0,
    });
    expect(row.querySelector(".bd-card__why")).toBeNull();
    expect(row.querySelector(".bd-card__line")?.textContent).toBe("x.somethingNew");
  });
});
