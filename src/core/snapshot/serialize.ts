import type { OwnMarkup } from "../botdarMarks.ts";

/**
 * Serialises a live document the way the recorded fixtures store it: open shadow roots become
 * `<template shadowrootmode="open">` children of their host, which the fixture loader and Chrome's
 * parser both hydrate back into real shadow roots.
 *
 * The function is deliberately self-contained (no imports, no outer references, every constant
 * inside the body): the capture script hands it to Playwright's `page.evaluate`, which ships the
 * function's source to the page, so anything it closed over would be undefined there. Keep it that
 * way when editing; the unit test that stringifies it guards the rule. Botdar's own markup arrives
 * as `ownMarkup` (OWN_MARKUP in src/core/botdarMarks.ts) for the same reason: an argument survives
 * the trip, an import would not.
 */
export function serializeDocument(root: Document, ownMarkup: OwnMarkup): string {
  // Scripts, styles and frames carry nothing the adapters read and would run or load again when
  // the fixture is served; Botdar's own hosts are dropped so a recording has no badges baked in.
  const droppedTags: ReadonlySet<string> = new Set([
    "script",
    "style",
    "link",
    "iframe",
    "noscript",
    ...ownMarkup.hostElementNames,
  ]);
  const voidTags: ReadonlySet<string> = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "meta",
    "source",
    "track",
    "wbr",
  ]);
  const escapeText = (text: string): string =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttribute = (value: string): string => escapeText(value).replace(/"/g, "&quot;");

  const serializeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? "");
    if (node.nodeType === Node.COMMENT_NODE) return "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    const tag: string = element.tagName.toLowerCase();
    if (droppedTags.has(tag)) return "";
    // Botdar marks each item it has badged; a recording that kept the mark could never be badged
    // again when replayed, so the mark goes the way the badge hosts do.
    const attributes: string = Array.from(element.attributes)
      .filter((attribute) => attribute.name !== ownMarkup.badgedAttribute)
      .map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`)
      .join("");
    if (voidTags.has(tag)) return `<${tag}${attributes}>`;
    const shadow: ShadowRoot | null = element.shadowRoot;
    const shadowMarkup: string =
      shadow === null
        ? ""
        : `<template shadowrootmode="open">${serializeChildren(shadow)}</template>`;
    return `<${tag}${attributes}>${shadowMarkup}${serializeChildren(element)}</${tag}>`;
  };
  const serializeChildren = (parent: Node): string =>
    Array.from(parent.childNodes).map(serializeNode).join("");

  return `<!doctype html>\n${serializeNode(root.documentElement)}\n`;
}
