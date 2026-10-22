import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * happy-dom keeps `<template shadowrootmode>` as a plain template instead of attaching a shadow
 * root, so the declarative shadow DOM in the fixtures is hydrated by hand after insertion.
 */
export function hydrateDeclarativeShadowRoots(root: ParentNode): void {
  for (const template of root.querySelectorAll<HTMLTemplateElement>("template[shadowrootmode]")) {
    const host: HTMLElement | null = template.parentElement;
    if (host === null) continue;
    const mode: ShadowRootMode =
      template.getAttribute("shadowrootmode") === "closed" ? "closed" : "open";
    const shadow: ShadowRoot = host.attachShadow({ mode });
    shadow.append(template.content);
    template.remove();
    hydrateDeclarativeShadowRoots(shadow);
  }
}

/** Resolved from the project root: under the happy-dom environment import.meta.url is the page URL. */
export function redditFixtureHtml(name: string): string {
  return readFileSync(resolve(process.cwd(), "tests/fixtures/reddit/html", name), "utf8");
}

function bodyOf(html: string): string {
  const body: RegExpExecArray | null = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return body?.[1] ?? html;
}

/** Replaces the document body with the fixture's body and hydrates its shadow roots. */
export function loadRedditFixture(name: string): void {
  document.body.innerHTML = bodyOf(redditFixtureHtml(name));
  hydrateDeclarativeShadowRoots(document.body);
}

/** Parses an HTML snippet into a detached element with its shadow roots hydrated. */
export function snippet(html: string): Element {
  const container: HTMLDivElement = document.createElement("div");
  container.innerHTML = html;
  hydrateDeclarativeShadowRoots(container);
  const first: Element | null = container.firstElementChild;
  if (first === null) throw new Error("snippet has no element");
  return first;
}

export const OLD_REDDIT_POST = `
<div class="thing id-t3_abc link" data-author="Quiet_Lantern_4821" data-fullname="t3_abc">
  <div class="entry unvoted">
    <p class="title"><a class="title" href="/r/woodworking/comments/abc/">Side table</a></p>
    <p class="tagline">
      submitted 2 days ago by <a href="https://old.reddit.com/user/Quiet_Lantern_4821" class="author">Quiet_Lantern_4821</a>
      to <a href="/r/woodworking/" class="subreddit">r/woodworking</a>
    </p>
  </div>
</div>`;

export const OLD_REDDIT_COMMENT_THREAD = `
<div class="thing id-t1_one comment" data-author="Mossy_Teapot" data-fullname="t1_one">
  <div class="entry unvoted">
    <p class="tagline"><a href="https://old.reddit.com/user/Mossy_Teapot" class="author">Mossy_Teapot</a></p>
  </div>
  <div class="child">
    <div class="thing id-t1_two comment" data-author="Deal_Scout_90210" data-fullname="t1_two">
      <div class="entry unvoted">
        <p class="tagline"><a href="https://old.reddit.com/user/Deal_Scout_90210" class="author">Deal_Scout_90210</a></p>
      </div>
    </div>
  </div>
</div>`;
