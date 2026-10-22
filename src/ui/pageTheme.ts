/**
 * Theme plumbing for the extension pages (popup, options, onboarding). They are plain documents,
 * not shadow roots, so the tokens are re-targeted from `:host` to `:root` at runtime and
 * `data-theme` on the root element follows the system colour scheme. tokens.css stays the one source.
 */
import tokensSource from "./tokens.css?raw";

export type PageTheme = "light" | "dark";

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";
export const PAGE_TOKENS_STYLE_ID = "botdar-page-tokens";

/** `:host` and `:host([data-theme=…])` become `:root` and `:root[data-theme=…]`. */
export function pageTokensCss(source: string = tokensSource): string {
  return source.replace(/:host\(([^)]*)\)/g, ":root$1").replace(/:host\b/g, ":root");
}

export function installPageTokens(doc: Document = document): void {
  if (doc.getElementById(PAGE_TOKENS_STYLE_ID) !== null) return;
  const style: HTMLStyleElement = doc.createElement("style");
  style.id = PAGE_TOKENS_STYLE_ID;
  style.textContent = pageTokensCss();
  doc.head.append(style);
}

/** Installs the tokens and keeps `data-theme` in step with the system scheme; returns a stop function. */
export function applyPageTheme(doc: Document = document): () => void {
  installPageTokens(doc);
  const query: MediaQueryList | undefined = doc.defaultView?.matchMedia(DARK_SCHEME_QUERY);
  const apply = (): void => {
    doc.documentElement.dataset.theme = query?.matches === true ? "dark" : "light";
  };
  apply();
  if (query === undefined) return () => undefined;
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}
