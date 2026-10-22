// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}

import type { ContentScriptContext } from "wxt/utils/content-script-context";
import type { MountedUi, RenderFn } from "@/src/ui/mount";
import {
  BADGE_ELEMENT_NAME,
  CARD_ELEMENT_NAME,
  detectHostTheme,
  mountBadge,
  mountCard,
  shadowStyles,
} from "@/src/ui/mount";

const BADGE_CSS = ":host { --botdar-test: badge; }";
const CARD_CSS = ":host { --botdar-test: card; }";

const fakeContext = (): ContentScriptContext =>
  ({ options: {}, onInvalidated: () => () => undefined }) as unknown as ContentScriptContext;

const resetDocument = (): void => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.className = "";
  document.body.removeAttribute("style");
  document.body.className = "";
  document.body.innerHTML = "";
};

describe("detectHostTheme", () => {
  beforeEach(resetDocument);

  describe("x", () => {
    it("reads a dark background on the root element", () => {
      document.documentElement.style.backgroundColor = "rgb(0, 0, 0)";
      expect(detectHostTheme("x")).toBe("dark");
      document.documentElement.style.backgroundColor = "rgb(21, 32, 43)";
      expect(detectHostTheme("x")).toBe("dark");
    });

    it("reads a light background on the root element", () => {
      document.documentElement.style.backgroundColor = "rgb(255, 255, 255)";
      expect(detectHostTheme("x")).toBe("light");
    });

    it("falls back to the body colour scheme when the background is transparent", () => {
      document.body.style.colorScheme = "dark";
      expect(detectHostTheme("x")).toBe("dark");
      document.body.style.colorScheme = "light";
      expect(detectHostTheme("x")).toBe("light");
    });

    it("defaults to light", () => {
      expect(detectHostTheme("x")).toBe("light");
    });
  });

  describe("reddit", () => {
    it("reads html[data-theme]", () => {
      document.documentElement.dataset.theme = "dark";
      expect(detectHostTheme("reddit")).toBe("dark");
      document.documentElement.dataset.theme = "light";
      expect(detectHostTheme("reddit")).toBe("light");
    });

    it("reads the theme-dark class on html or body", () => {
      document.documentElement.classList.add("theme-dark");
      expect(detectHostTheme("reddit")).toBe("dark");
      document.documentElement.className = "";
      document.body.classList.add("theme-dark");
      expect(detectHostTheme("reddit")).toBe("dark");
    });

    it("defaults to light", () => {
      expect(detectHostTheme("reddit")).toBe("light");
    });
  });

  describe("bluesky", () => {
    it("treats any declared theme other than light as dark", () => {
      document.documentElement.dataset.theme = "dim";
      expect(detectHostTheme("bluesky")).toBe("dark");
      document.documentElement.dataset.theme = "dark";
      expect(detectHostTheme("bluesky")).toBe("dark");
      document.documentElement.dataset.theme = "light";
      expect(detectHostTheme("bluesky")).toBe("light");
    });

    it("falls back to prefers-color-scheme", () => {
      const matchMedia = vi
        .spyOn(window, "matchMedia")
        .mockReturnValue({ matches: true } as MediaQueryList);
      expect(detectHostTheme("bluesky")).toBe("dark");
      matchMedia.mockReturnValue({ matches: false } as MediaQueryList);
      expect(detectHostTheme("bluesky")).toBe("light");
      matchMedia.mockRestore();
    });
  });
});

describe("mountBadge", () => {
  beforeEach(resetDocument);

  const makeAnchor = (): HTMLElement => {
    const post = document.createElement("article");
    const anchor = document.createElement("a");
    anchor.textContent = "@someone";
    post.append(anchor);
    document.body.append(post);
    return anchor;
  };

  const trackedRender = (): { render: RenderFn; unmount: ReturnType<typeof vi.fn> } => {
    const unmount = vi.fn();
    const render = vi.fn((container: HTMLElement) => {
      container.textContent = "badge";
      return unmount;
    });
    return { render, unmount };
  };

  it("mounts a badge host inline after the anchor with the theme set", async () => {
    const anchor = makeAnchor();
    const { render } = trackedRender();

    const mounted: MountedUi = await mountBadge(fakeContext(), anchor, render, "dark", BADGE_CSS);

    expect(anchor.nextElementSibling).toBe(mounted.shadowHost);
    expect(mounted.shadowHost.tagName.toLowerCase()).toBe(BADGE_ELEMENT_NAME);
    expect(mounted.shadowHost.dataset.theme).toBe("dark");
    expect(render).toHaveBeenCalledTimes(1);
    expect(mounted.shadowHost.shadowRoot?.textContent).toContain("badge");
  });

  it("writes the given stylesheet into the shadow root without fetching anything", async () => {
    const anchor = makeAnchor();
    const { render } = trackedRender();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const mounted: MountedUi = await mountBadge(fakeContext(), anchor, render, "light", BADGE_CSS);

    expect(mounted.shadowHost.shadowRoot?.querySelector("style")?.textContent).toContain(BADGE_CSS);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("lays the badge host out inline with the handle", async () => {
    const anchor = makeAnchor();
    const { render } = trackedRender();

    const mounted: MountedUi = await mountBadge(fakeContext(), anchor, render, "light", BADGE_CSS);

    const hostStyle: CSSStyleDeclaration = getComputedStyle(mounted.shadowHost);
    expect(hostStyle.display).toBe("inline-flex");
    expect(hostStyle.verticalAlign).toBe("middle");
    expect(hostStyle.marginLeft).toBe("4px");
  });

  it("reuses an existing badge sibling and updates its theme", async () => {
    const anchor = makeAnchor();
    const { render } = trackedRender();
    const first: MountedUi = await mountBadge(fakeContext(), anchor, render, "light", BADGE_CSS);

    const second: MountedUi = await mountBadge(fakeContext(), anchor, render, "dark", BADGE_CSS);

    expect(second).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);
    expect(first.shadowHost.dataset.theme).toBe("dark");
    expect(anchor.parentElement?.querySelectorAll(BADGE_ELEMENT_NAME)).toHaveLength(1);
  });

  it("shares one mount between concurrent calls for the same anchor", async () => {
    const anchor = makeAnchor();
    const { render } = trackedRender();

    const [first, second] = await Promise.all([
      mountBadge(fakeContext(), anchor, render, "light", BADGE_CSS),
      mountBadge(fakeContext(), anchor, render, "light", BADGE_CSS),
    ]);

    expect(second).toBe(first);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("adopts a badge sibling mounted by an earlier script instance", async () => {
    const anchor = makeAnchor();
    const orphan = document.createElement(BADGE_ELEMENT_NAME);
    anchor.after(orphan);
    const { render } = trackedRender();

    const mounted: MountedUi = await mountBadge(fakeContext(), anchor, render, "dark", BADGE_CSS);

    expect(mounted.shadowHost).toBe(orphan);
    expect(orphan.dataset.theme).toBe("dark");
    expect(render).not.toHaveBeenCalled();
    mounted.remove();
    expect(orphan.isConnected).toBe(false);
  });

  it("unmounts the rendered UI and removes the host on remove", async () => {
    const anchor = makeAnchor();
    const { render, unmount } = trackedRender();
    const mounted: MountedUi = await mountBadge(fakeContext(), anchor, render, "light", BADGE_CSS);

    mounted.remove();

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(mounted.shadowHost.isConnected).toBe(false);
    const remounted: MountedUi = await mountBadge(
      fakeContext(),
      anchor,
      render,
      "light",
      BADGE_CSS,
    );
    expect(remounted).not.toBe(mounted);
    expect(render).toHaveBeenCalledTimes(2);
  });
});

describe("shadowStyles", () => {
  it("joins the sheets with newlines in the given order", () => {
    expect(shadowStyles(":host { a: 1 }", ":host { b: 2 }")).toBe(":host { a: 1 }\n:host { b: 2 }");
    expect(shadowStyles()).toBe("");
  });
});

describe("mountCard", () => {
  beforeEach(resetDocument);

  it("appends one card to the body and returns it on repeated calls", async () => {
    const render = vi.fn((container: HTMLElement) => {
      container.textContent = "card";
      return () => undefined;
    });

    const first: MountedUi = await mountCard(fakeContext(), render, "light", CARD_CSS);
    const second: MountedUi = await mountCard(fakeContext(), render, "dark", CARD_CSS);

    expect(second.shadowHost).toBe(first.shadowHost);
    expect(first.shadowHost.parentElement).toBe(document.body);
    expect(first.shadowHost.tagName.toLowerCase()).toBe(CARD_ELEMENT_NAME);
    expect(first.shadowHost.dataset.theme).toBe("dark");
    expect(first.shadowHost.shadowRoot?.querySelector("style")?.textContent).toContain(CARD_CSS);
    expect(getComputedStyle(first.shadowHost).position).toBe("fixed");
    expect(render).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll(CARD_ELEMENT_NAME)).toHaveLength(1);

    second.remove();
    expect(document.body.querySelectorAll(CARD_ELEMENT_NAME)).toHaveLength(0);
    const third: MountedUi = await mountCard(fakeContext(), render, "light", CARD_CSS);
    expect(third.shadowHost).not.toBe(first.shadowHost);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("positions and shows the card through custom properties the host reset cannot wipe", async () => {
    const card: MountedUi = await mountCard(
      fakeContext(),
      () => () => undefined,
      "light",
      CARD_CSS,
    );
    const host: HTMLElement = card.shadowHost;

    const hostRules: string = host.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(hostRules).toContain("top: var(--botdar-top");
    expect(hostRules).toContain("display: var(--botdar-display, none)");

    card.setPlacement({ top: 120, left: 40 });
    card.setVisible(true);
    expect(host.style.getPropertyValue("--botdar-top")).toBe("120px");
    expect(host.style.getPropertyValue("--botdar-left")).toBe("40px");
    expect(host.style.getPropertyValue("--botdar-display")).toBe("block");

    card.setVisible(false);
    expect(host.style.getPropertyValue("--botdar-display")).toBe("none");
  });
});
