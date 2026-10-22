import { readFileSync } from "node:fs";
import { join } from "node:path";

const BODY_PATTERN = /<body[^>]*>([\s\S]*)<\/body>/;

/** happy-dom rebinds URL to the page origin, so the fixture is located from the project root. */
export function timelineBodyHtml(): string {
  const html: string = readFileSync(
    join(process.cwd(), "tests/fixtures/x/html/timeline.html"),
    "utf8",
  );
  const body: string | undefined = BODY_PATTERN.exec(html)?.[1];
  if (body === undefined) {
    throw new Error("timeline fixture has no body");
  }
  return body;
}

export function loadTimeline(target: Document = document): void {
  target.body.innerHTML = timelineBodyHtml();
}

export function timelineArticles(target: Document = document): Element[] {
  return Array.from(target.querySelectorAll('article[data-testid="tweet"]'));
}
