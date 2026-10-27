// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { HoverCard, type HoverCardProps } from "@/src/ui/HoverCard";

function newContainer(): HTMLElement {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  return container;
}

/** Renders a card; passing the container of an earlier mount re-renders it, as a rescore does. */
function mount(
  overrides: Partial<HoverCardProps> = {},
  container: HTMLElement = newContainer(),
): HTMLElement {
  const props: HoverCardProps = {
    id: "botdar-card",
    opening: 1,
    tier: "many",
    labelStyle: "plain",
    handle: "@news_update_48213",
    reasons: [
      {
        text: "Joined 3 weeks ago",
        why: "new accounts often replace banned ones",
        direction: "automated",
        contribution: 1.2,
        tier: 1,
      },
      {
        text: "Following 4,900, followed by 12",
        why: "mass-following nobody returned",
        direction: "automated",
        contribution: 0.4,
        tier: 2,
      },
    ],
    caveat: "News desks and brand accounts post at this rate too.",
    loading: false,
    lowConfidence: false,
    showLegend: true,
    feedbackSent: false,
    onFeedback: () => {},
    onSettings: () => {},
    ...overrides,
  };
  render(<HoverCard {...props} />, container);
  return container;
}

describe("HoverCard", () => {
  it("renders the title, handle, reasons with source dots, legend and caveat", () => {
    const card: HTMLElement = mount();
    expect(card.querySelector(".bd-card__title")?.textContent).toBe("Likely bot");
    expect(card.querySelector(".bd-card__handle")?.textContent).toBe("@news_update_48213");
    expect(card.querySelectorAll(".bd-card__reason")).toHaveLength(2);
    expect(card.querySelector(".bd-card__reason .bd-dot--2")).not.toBeNull();
    expect(card.querySelector(".bd-card__legend")).not.toBeNull();
    expect(card.querySelector(".bd-card__caveat")?.textContent).toContain("News desks");
    expect(card.querySelector("[role=dialog]")?.getAttribute("aria-label")).toBe(
      "Likely bot: @news_update_48213",
    );
  });

  it("labels the reasons and the caveat as separate blocks, with the note last", () => {
    const card: HTMLElement = mount({ confidenceNote: "Extra lookups are off" });
    const blocks: string[] = [
      ...card.querySelectorAll(
        ".bd-card__label, .bd-card__reasons, .bd-card__caveat, .bd-card__note",
      ),
    ].map((element: Element) => element.className);
    expect(blocks).toEqual([
      "bd-card__label",
      "bd-card__reasons",
      "bd-card__label",
      "bd-card__caveat",
      "bd-card__note",
    ]);
    const labels: string[] = [...card.querySelectorAll(".bd-card__label")].map(
      (element: Element) => element.textContent ?? "",
    );
    expect(labels).toEqual(["Why it leans this way", "Why this could be wrong"]);
    const markerNames: string[] = [...card.querySelectorAll(".bd-card__lean")].map(
      (element: Element) => element.getAttribute("aria-label") ?? "",
    );
    expect(markerNames).toEqual([
      "Strong, points towards automated",
      "Moderate, points towards automated",
    ]);
  });

  it("heads a declared card's closing line as what the label means, with a neutral marker", () => {
    const card: HTMLElement = mount({
      tier: "declared",
      reasons: [
        {
          text: "Carries the platform's own automated-account label",
          why: "self-declared",
          direction: "automated",
          tier: 0,
        },
      ],
      caveat: "The account operator chose to label it as automated.",
    });
    const labels: string[] = [...card.querySelectorAll(".bd-card__label")].map(
      (element: Element) => element.textContent ?? "",
    );
    expect(labels).toEqual(["Why it leans this way", "What this means"]);
    expect(card.querySelector(".bd-card--declared .bd-card__reason--automated")).not.toBeNull();
    expect(card.querySelector(".bd-card__strength")).toBeNull();
    // Its clause, "self-declared", would only repeat the "What this means" block.
    expect(card.querySelector(".bd-card__why-toggle")).toBeNull();
    expect(card.querySelector(".bd-card__why")).toBeNull();
    expect(card.querySelector(".bd-card__lean")?.getAttribute("aria-label")).toBe(
      "Points towards automated",
    );
  });

  it("leaves out the reasons label when there are no reasons", () => {
    const card: HTMLElement = mount({ reasons: [] });
    const labels: string[] = [...card.querySelectorAll(".bd-card__label")].map(
      (element: Element) => element.textContent ?? "",
    );
    expect(labels).toEqual(["Why this could be wrong"]);
  });

  it("uses the sus title but keeps the plain dialog label", () => {
    const card: HTMLElement = mount({ labelStyle: "sus" });
    expect(card.querySelector(".bd-card__title")?.textContent).toBe("Sus");
    expect(card.querySelector("[role=dialog]")?.getAttribute("aria-label")).toContain("Likely bot");
  });

  it("shows the checking state with feedback disabled", () => {
    const card: HTMLElement = mount({ loading: true, reasons: [] });
    expect(card.querySelector(".bd-card__title")?.textContent).toBe("Checking");
    expect(card.querySelector("[role=dialog]")?.getAttribute("aria-busy")).toBe("true");
    expect((card.querySelector(".bd-btn") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a No read card with its explanation and no reasons, caveat or feedback", () => {
    const card: HTMLElement = mount({
      tier: "unknown",
      reasons: [],
      explanation: "The platform returned no profile details.",
      confidenceNote: "Extra lookups not run yet",
    });
    expect(card.querySelector(".bd-card__title")?.textContent).toBe("No read");
    expect(card.querySelector(".bd-card__explain")?.textContent).toBe(
      "The platform returned no profile details.",
    );
    expect(card.querySelector(".bd-card__reasons")).toBeNull();
    expect(card.querySelector(".bd-card__caveat")).toBeNull();
    expect(card.querySelector(".bd-card__note")).toBeNull();
    expect(card.querySelector(".bd-card__label")).toBeNull();
    expect(card.querySelector(".bd-btn--link")?.textContent).toBe("Settings");
    expect(card.querySelectorAll(".bd-btn")).toHaveLength(1);
    expect(card.querySelector(".bd-badge--unknown")).not.toBeNull();
  });

  it("titles a No read card Checking while its lookup runs", () => {
    const card: HTMLElement = mount({ tier: "unknown", reasons: [], loading: true });
    expect(card.querySelector(".bd-card__title")?.textContent).toBe("Checking");
    expect(card.querySelector("[role=dialog]")?.getAttribute("aria-label")).toBe(
      "Checking: @news_update_48213",
    );
  });

  it("hides every why clause behind one closed toggle under the reasons", () => {
    const card: HTMLElement = mount();
    expect(card.querySelector(".bd-card__why")).toBeNull();
    const toggle: HTMLButtonElement | null = card.querySelector(".bd-card__why-toggle");
    expect(toggle?.tagName).toBe("BUTTON");
    expect(toggle?.type).toBe("button");
    expect(toggle?.hasAttribute("tabindex")).toBe(false);
    expect(toggle?.textContent).toBe("What these mean");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.getAttribute("aria-controls")).toBe("botdar-card-reasons");
    expect(card.querySelector(".bd-card__reasons")?.id).toBe("botdar-card-reasons");
    expect(card.querySelector(".bd-card__reasons + .bd-card__why-toggle")).toBe(toggle);
  });

  it("opens and closes every why clause together", () => {
    const card: HTMLElement = mount();
    const toggle: HTMLButtonElement | null = card.querySelector(".bd-card__why-toggle");
    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle?.textContent).toBe("Hide explanations");
    expect(card.querySelector(".bd-card__reasons--open")).not.toBeNull();
    const whyLines: string[] = [...card.querySelectorAll(".bd-card__why")].map(
      (element: Element) => element.textContent ?? "",
    );
    expect(whyLines).toEqual([
      "New accounts often replace banned ones.",
      "Mass-following nobody returned.",
    ]);

    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector(".bd-card__why")).toBeNull();
  });

  it("words the toggle for a single reason", () => {
    const card: HTMLElement = mount({
      reasons: [
        {
          text: "Joined 3 weeks ago",
          why: "new accounts often replace banned ones",
          direction: "automated",
          contribution: 1.2,
          tier: 1,
        },
      ],
    });
    const toggle: HTMLButtonElement | null = card.querySelector(".bd-card__why-toggle");
    expect(toggle?.textContent).toBe("What this means");
    act(() => toggle?.click());
    expect(toggle?.textContent).toBe("Hide explanation");
  });

  it("words the toggle by the clauses it reveals, not by the rows", () => {
    const card: HTMLElement = mount({
      reasons: [
        {
          text: "Joined 3 weeks ago",
          why: "new accounts often replace banned ones",
          direction: "automated",
          contribution: 1.2,
          tier: 1,
        },
        { text: "x.somethingNew", why: "", direction: "automated", contribution: 0.2, tier: 0 },
      ],
    });
    const toggle: HTMLButtonElement | null = card.querySelector(".bd-card__why-toggle");
    expect(toggle?.textContent).toBe("What this means");
    act(() => toggle?.click());
    expect(toggle?.textContent).toBe("Hide explanation");
    expect(card.querySelectorAll(".bd-card__why")).toHaveLength(1);
  });

  it("closes the clauses when a rescore takes every one away, and keeps them closed after", () => {
    const card: HTMLElement = mount();
    act(() => card.querySelector<HTMLButtonElement>(".bd-card__why-toggle")?.click());
    expect(card.querySelector(".bd-card__reasons--open")).not.toBeNull();

    const unexplained = [
      { text: "x.somethingNew", why: "", direction: "automated", contribution: 0.2, tier: 0 },
    ] as const;
    act(() => {
      mount({ reasons: [...unexplained] }, card);
    });
    expect(card.querySelector(".bd-card__reasons--open")).toBeNull();
    expect(card.querySelector(".bd-card__why-toggle")).toBeNull();

    act(() => {
      mount({}, card);
    });
    expect(card.querySelector(".bd-card__why-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelector(".bd-card__why")).toBeNull();
  });

  it("starts a new opening with the clauses hidden, and keeps them open within one", () => {
    const card: HTMLElement = mount();
    act(() => card.querySelector<HTMLButtonElement>(".bd-card__why-toggle")?.click());
    // A rescore during the same opening keeps the reader's choice.
    act(() => {
      mount({ caveat: "Rescored." }, card);
    });
    expect(card.querySelector(".bd-card__reasons--open")).not.toBeNull();
    act(() => {
      mount({ opening: 2 }, card);
    });
    expect(card.querySelector(".bd-card__reasons--open")).toBeNull();
    expect(card.querySelector(".bd-card__why")).toBeNull();
  });

  it("never explains a reason that carries no contribution, whatever the tier", () => {
    const card: HTMLElement = mount({
      tier: "some",
      reasons: [
        {
          text: "Carries the platform's own automated-account label",
          why: "self-declared",
          direction: "automated",
          tier: 0,
        },
      ],
    });
    expect(card.querySelector(".bd-card__why-toggle")).toBeNull();
  });

  it("draws no toggle when no reason has a why clause", () => {
    const card: HTMLElement = mount({
      reasons: [{ text: "x.somethingNew", why: "", direction: "automated", tier: 0 }],
    });
    expect(card.querySelector(".bd-card__why-toggle")).toBeNull();
  });

  it("calls the feedback handler and shows the sent state", () => {
    const onFeedback = vi.fn();
    const card: HTMLElement = mount({ onFeedback });
    (card.querySelector(".bd-btn") as HTMLButtonElement).click();
    expect(onFeedback).toHaveBeenCalled();
    expect(mount({ feedbackSent: true }).querySelector(".bd-btn--sent")?.textContent).toContain(
      "Noted",
    );
  });
});
