// @vitest-environment happy-dom
import { render } from "preact";
import { allWhyClauses } from "@/src/core/scoring/whyClauses";
import { ReasonRow, type CardReason } from "@/src/ui/ReasonRow";

function mountRow(reason: CardReason, whyShown = false): HTMLElement {
  const list: HTMLUListElement = document.createElement("ul");
  document.body.append(list);
  render(<ReasonRow reason={reason} whyShown={whyShown} />, list);
  return list;
}

function markerName(row: HTMLElement): string | null {
  return row.querySelector(".bd-card__lean")?.getAttribute("aria-label") ?? null;
}

describe("ReasonRow", () => {
  it("shows the strength and direction, the observation and its source", () => {
    const row: HTMLElement = mountRow({
      text: "Joined 3 weeks ago",
      why: "new accounts often replace banned ones",
      direction: "automated",
      contribution: 1.2,
      tier: 1,
    });
    const lean: Element | null = row.querySelector(".bd-card__lean");
    expect(lean?.textContent).toBe("↑");
    expect(lean?.getAttribute("role")).toBe("img");
    expect(lean?.getAttribute("aria-label")).toBe("Strong, points towards automated");
    expect(lean?.getAttribute("title")).toBe("Strong, points towards automated");
    expect(lean?.querySelector(".bd-card__strength-fill")).not.toBeNull();
    expect(row.querySelector(".bd-card__reason--automated.bd-card__reason--strong")).not.toBeNull();
    expect(row.querySelector(".bd-card__fact")?.textContent).toBe("Joined 3 weeks ago");
    expect(row.querySelector(".bd-dot--1")).not.toBeNull();
  });

  it("keeps the why clause out of the row until the reader asks for it", () => {
    const reason: CardReason = {
      text: "Joined 3 weeks ago",
      why: "new accounts often replace banned ones",
      direction: "automated",
      contribution: 1.2,
      tier: 1,
    };
    expect(mountRow(reason).querySelector(".bd-card__why")).toBeNull();
    expect(mountRow(reason).querySelector(".bd-card__line")?.textContent).toBe(
      "Joined 3 weeks ago",
    );
  });

  it("shows the why clause as a sentence on its own line once asked", () => {
    const row: HTMLElement = mountRow(
      {
        text: "~102 posts/day since joining",
        why: "prolonged hyperactivity",
        direction: "automated",
        contribution: 2,
        tier: 1,
      },
      true,
    );
    expect(row.querySelector(".bd-card__fact")?.textContent).toBe("~102 posts/day since joining");
    expect(row.querySelector(".bd-card__why")?.textContent).toBe("Prolonged hyperactivity.");
  });

  it("marks evidence that points towards an ordinary account with its own shape and label", () => {
    const row: HTMLElement = mountRow({
      text: "Account is 9 years old",
      why: "outlasted platform enforcement",
      direction: "ordinary",
      contribution: -0.8,
      tier: 2,
    });
    expect(row.querySelector(".bd-card__lean")?.textContent).toBe("↓");
    expect(markerName(row)).toBe("Strong, points towards ordinary");
    expect(row.querySelector(".bd-card__reason--ordinary.bd-card__reason--strong")).not.toBeNull();
  });

  it.each([
    ["automated", 0.4, "moderate", "Moderate, points towards automated"],
    ["automated", 0.1, "weak", "Weak, points towards automated"],
    ["ordinary", -0.3, "moderate", "Moderate, points towards ordinary"],
    ["ordinary", 0, "weak", "Weak, points towards ordinary"],
  ] as const)(
    "names a %s reason of %d by its strength and direction",
    (direction, contribution, strength, name) => {
      const row: HTMLElement = mountRow({
        text: "Custom avatar",
        why: "someone set it up",
        direction,
        contribution,
        tier: 0,
      });
      expect(markerName(row)).toBe(name);
      expect(row.querySelector(`.bd-card__reason--${strength}`)).not.toBeNull();
    },
  );

  it("draws no strength bar for the declared disclosure, which is not weighed", () => {
    const row: HTMLElement = mountRow({
      text: "Carries the platform's own automated-account label",
      why: "self-declared",
      direction: "automated",
      tier: 0,
    });
    expect(markerName(row)).toBe("Points towards automated");
    expect(row.querySelector(".bd-card__strength")).toBeNull();
    expect(row.querySelector(".bd-card__reason--weak, .bd-card__reason--moderate")).toBeNull();
    expect(row.querySelector(".bd-card__reason--strong")).toBeNull();
  });

  it("renders every clause as a sentence with a capital and exactly one terminal mark", () => {
    const clauses: string[] = [...allWhyClauses(), "already a sentence.", "is it?"];
    for (const why of clauses) {
      const sentence: string | null | undefined = mountRow(
        { text: "Fact", why, direction: "automated", contribution: 1, tier: 0 },
        true,
      ).querySelector(".bd-card__why")?.textContent;
      expect(sentence).toMatch(/^[A-Z]/);
      expect(sentence).toMatch(/[^.!?][.!?]$/);
    }
  });

  it("shows no why line for a reason without a clause, even when asked", () => {
    const row: HTMLElement = mountRow(
      {
        text: "x.somethingNew",
        why: "",
        direction: "automated",
        contribution: 0.2,
        tier: 0,
      },
      true,
    );
    expect(row.querySelector(".bd-card__why")).toBeNull();
    expect(row.querySelector(".bd-card__line")?.textContent).toBe("x.somethingNew");
  });
});
