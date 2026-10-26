// @vitest-environment happy-dom
import { render } from "preact";
import { HoverCard, type HoverCardProps } from "@/src/ui/HoverCard";

function mount(overrides: Partial<HoverCardProps> = {}): HTMLElement {
  const container: HTMLDivElement = document.createElement("div");
  document.body.append(container);
  const props: HoverCardProps = {
    id: "botdar-card",
    tier: "many",
    labelStyle: "plain",
    handle: "@news_update_48213",
    reasons: [
      {
        text: "Joined 3 weeks ago",
        why: "new accounts often replace banned ones",
        direction: "automated",
        tier: 1,
      },
      {
        text: "Following 4,900, followed by 12",
        why: "mass-following nobody returned",
        direction: "automated",
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
    expect(card.querySelector(".bd-card__why")?.textContent).toBe(
      " · new accounts often replace banned ones",
    );
    expect(card.querySelector(".bd-card__lean")?.getAttribute("aria-label")).toBe(
      "Points towards automated",
    );
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
