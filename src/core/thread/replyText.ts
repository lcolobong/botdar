/**
 * Reading a reply's own words from the page for the thread index (ADR-0027). Quoted text is
 * someone else's words: a reply that quotes another in full before answering it is not a copy, so
 * each platform names what it renders quotes as and that part is left out.
 */

const TEXT_NODE_FILTER = 4; // NodeFilter.SHOW_TEXT, spelled out so the module loads without a DOM.

/**
 * The text of `root` without whatever sits inside an element matching `excludedSelector` within it.
 * Text nodes are joined with spaces so words in adjacent blocks never run together; the reply
 * normaliser collapses the extra spaces.
 */
export function textOutside(root: Element, excludedSelector: string): string {
  const parts: string[] = [];
  const walker: TreeWalker = root.ownerDocument.createTreeWalker(root, TEXT_NODE_FILTER);
  for (let node: Node | null = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const excluded: Element | null | undefined = node.parentElement?.closest(excludedSelector);
    if (excluded === null || excluded === undefined || !root.contains(excluded)) {
      parts.push(node.textContent ?? "");
    }
  }
  return parts.join(" ");
}
