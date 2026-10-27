// @vitest-environment happy-dom

import { pageTimestampMillis, textOutside, withExplicitZone } from "@/src/core/thread/replyText";

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

describe("page timestamps", () => {
  it("gives Reddit's colon-less offset the colon the ECMAScript date format requires", () => {
    expect(withExplicitZone("2026-10-26T16:05:00.000+0000")).toBe("2026-10-26T16:05:00.000+00:00");
    expect(withExplicitZone("2026-10-26T16:05:00.000-0530")).toBe("2026-10-26T16:05:00.000-05:30");
    expect(withExplicitZone("2026-10-26T16:05:00.000+00:00")).toBe("2026-10-26T16:05:00.000+00:00");
  });

  it("reads a time without a zone, as Hacker News renders it, as UTC", () => {
    expect(withExplicitZone("2026-10-26T18:05:03")).toBe("2026-10-26T18:05:03Z");
    expect(pageTimestampMillis("2026-10-26T18:05:03")).toBe(Date.UTC(2026, 9, 26, 18, 5, 3));
  });

  it("answers undefined for a time that does not parse", () => {
    expect(pageTimestampMillis("")).toBeUndefined();
    expect(pageTimestampMillis("yesterday")).toBeUndefined();
  });
});
