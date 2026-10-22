/**
 * One parsed stylesheet per stylesheet text, adopted by every badge and card shadow root instead of
 * a ~7 KB `<style>` copy in each (docs/performance.md, hotspot 4). A constructed sheet needs no
 * `web_accessible_resources` entry: the text is bundled with `?inline` as before (ADR-0013).
 */
import { splitShadowRootCss } from "wxt/utils/split-shadow-root-css";

export interface SharedStyles {
  /** Undefined where constructed sheets are unavailable; the text then goes into a `<style>`. */
  readonly sheet: CSSStyleSheet | undefined;
  readonly shadowCss: string;
  /**
   * `@property` and `@font-face` rules, which have no effect inside a shadow root. The caller hands
   * them to WXT, which moves them into the document as it did when it received the whole text.
   */
  readonly documentCss: string;
}

const sharedStylesByCss = new Map<string, SharedStyles>();

export function sharedStylesFor(css: string): SharedStyles {
  let styles: SharedStyles | undefined = sharedStylesByCss.get(css);
  if (styles === undefined) {
    const { shadowCss, documentCss } = splitShadowRootCss(css);
    let sheet: CSSStyleSheet | undefined;
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(shadowCss);
    } catch {
      sheet = undefined;
    }
    styles = { sheet, shadowCss, documentCss };
    sharedStylesByCss.set(css, styles);
  }
  return styles;
}

/**
 * Adopted sheets cascade after the shadow root's own `<style>` elements, so WXT's
 * `:host { all: initial !important }` reset and the host layout rules that follow it keep their
 * place ahead of the bundled sheets. Firefox can refuse a sheet adopted across a content script's
 * Xray wrapper, so a refusal falls back to a `<style>` copy, which is what every root used to get.
 */
export function applySharedStyles(shadow: ShadowRoot, styles: SharedStyles): void {
  if (styles.sheet !== undefined) {
    try {
      shadow.adoptedStyleSheets = [styles.sheet];
      return;
    } catch {
      // Fall through to the inline copy.
    }
  }
  const style: HTMLStyleElement = document.createElement("style");
  style.textContent = styles.shadowCss;
  shadow.append(style);
}
