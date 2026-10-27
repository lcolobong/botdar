// @vitest-environment happy-dom

import { textOutside } from "@/src/core/thread/replyText";

function element(html: string): Element {
  const container: HTMLDivElement = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("textOutside", () => {
  it("leaves out text inside the excluded elements", () => {
    const root: Element = element("<blockquote><p>their words</p></blockquote><p>my answer</p>");
    expect(textOutside(root, "blockquote").trim()).toBe("my answer");
  });

  it("keeps words in adjacent blocks apart", () => {
    expect(textOutside(element("<p>first</p><p>second</p>"), "blockquote")).toBe("first second");
  });

  it("ignores a matching element around the root", () => {
    const outer: Element = element("<blockquote><div id='inner'>kept</div></blockquote>");
    const inner: Element | null = outer.querySelector("#inner");
    expect(inner === null ? "" : textOutside(inner, "blockquote")).toBe("kept");
  });
});
