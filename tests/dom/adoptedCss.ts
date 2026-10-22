/** The rules of the stylesheets a host's shadow root adopted, one per line, as the browser serialises them. */
export function adoptedCssOf(host: Element | null | undefined): string {
  return (host?.shadowRoot?.adoptedStyleSheets ?? [])
    .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
    .join("\n");
}
