// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { serializeDocument } from "../../../src/core/snapshot/serialize";
import { BADGE_ELEMENT_NAME, CARD_ELEMENT_NAME } from "../../../src/ui/mount";
import { hydrateDeclarativeShadowRoots } from "../../dom/reddit/fixtures";

function documentWithBody(body: string): Document {
  const parsed: Document = document.implementation.createHTMLDocument("capture");
  parsed.body.innerHTML = body;
  hydrateDeclarativeShadowRoots(parsed.body);
  return parsed;
}

describe("serializeDocument", () => {
  it("writes open shadow roots as declarative templates that the fixture loader hydrates back", () => {
    const html: string = serializeDocument(
      documentWithBody(`
        <shreddit-post author="Quiet_Lantern_4821">
          <template shadowrootmode="open"><div class="inner"><slot name="credit-bar"></slot></div></template>
          <div slot="credit-bar"><a href="/user/Quiet_Lantern_4821/">u/Quiet_Lantern_4821</a></div>
        </shreddit-post>`),
    );
    expect(html.startsWith("<!doctype html>\n<html>")).toBe(true);
    expect(html).toContain(
      '<shreddit-post author="Quiet_Lantern_4821"><template shadowrootmode="open">',
    );
    expect(html).toContain('<slot name="credit-bar"></slot>');

    const container: HTMLDivElement = document.createElement("div");
    container.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    hydrateDeclarativeShadowRoots(container);
    const host: Element | null = container.querySelector("shreddit-post");
    expect(host?.shadowRoot?.querySelector("slot[name='credit-bar']")).not.toBeNull();
  });

  it("drops scripts, styles, frames and Botdar's own hosts", () => {
    const html: string = serializeDocument(
      documentWithBody(`
        <script>alert(1)</script><style>body{}</style><link rel="stylesheet" href="x.css">
        <iframe src="about:blank"></iframe><noscript>no</noscript>
        <span>kept</span><${BADGE_ELEMENT_NAME}>b</${BADGE_ELEMENT_NAME}><${CARD_ELEMENT_NAME}>c</${CARD_ELEMENT_NAME}>`),
    );
    expect(
      serializeDocument(
        documentWithBody('<shreddit-post author="x" data-botdar="1" id="t3_a"></shreddit-post>'),
      ),
    ).toContain('<shreddit-post author="x" id="t3_a">');
    for (const dropped of [
      "<script",
      "<style",
      "<link",
      "<iframe",
      "<noscript",
      BADGE_ELEMENT_NAME,
      CARD_ELEMENT_NAME,
    ]) {
      expect(html).not.toContain(dropped);
    }
    expect(html).toContain("<span>kept</span>");
  });

  it("escapes text and attribute values and keeps void elements unclosed", () => {
    const html: string = serializeDocument(
      documentWithBody(`<p title='a "b" &amp; <c>'>x &lt; y &amp; z</p><img src="/a.png" alt="">`),
    );
    expect(html).toContain('<p title="a &quot;b&quot; &amp; &lt;c&gt;">x &lt; y &amp; z</p>');
    expect(html).toContain('<img src="/a.png" alt="">');
    expect(html).not.toContain("</img>");
  });

  it("stays self-contained so page.evaluate can ship its source", () => {
    const source: string = serializeDocument.toString();
    expect(source).not.toMatch(/\bimport\b|\brequire\(/);
    expect(
      new Function("root", `return (${source})(root)`)(documentWithBody("<b>ok</b>")),
    ).toContain("<b>ok</b>");
  });
});
