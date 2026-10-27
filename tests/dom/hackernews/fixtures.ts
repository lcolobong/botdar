import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type HackerNewsRecording = "front" | "thread" | "newcomments" | "newest" | "user";

/** Resolved from the project root: under the happy-dom environment import.meta.url is the page URL. */
export function hackerNewsFixtureHtml(name: HackerNewsRecording): string {
  return readFileSync(
    resolve(process.cwd(), "tests/fixtures/hackernews/html", `${name}.html`),
    "utf8",
  );
}

/** Replaces the document body with the recording's body. */
export function loadHackerNewsFixture(name: HackerNewsRecording): void {
  const html: string = hackerNewsFixtureHtml(name);
  const body: RegExpExecArray | null = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  document.body.innerHTML = body?.[1] ?? html;
}

/** Wraps hand-written rows in the table they need to parse as rows. */
export function loadRows(rows: string): void {
  document.body.innerHTML = `<table><tbody>${rows}</tbody></table>`;
}

/** A front-page job ad: Hacker News renders it with an age and no author. Hand-written. */
export const JOB_AD_ROWS = `
<tr class="athing submission" id="1000001"><td class="title"><span class="titleline"><a href="https://example.com/jobs">Example (YC S20) is hiring</a></span></td></tr>
<tr><td colspan="2"></td><td class="subtext"><span class="subline"><span class="age" title="2026-10-26T12:00:00"><a href="item?id=1000001">3 hours ago</a></span></span></td></tr>`;

/** A deleted comment in a thread keeps its row and indent but loses its author link. Hand-written. */
export const DELETED_COMMENT_ROW = `
<tr class="athing comtr" id="1000002"><td><table><tr><td class="ind" indent="1"></td><td class="default"><div><span class="comhead"> <span class="age" title="2026-10-26T12:00:00"><a href="item?id=1000002">3 hours ago</a></span></span></div><div class="comment">[deleted]</div></td></tr></table></td></tr>`;
