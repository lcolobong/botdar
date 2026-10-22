// @vitest-environment happy-dom
import {
  DARK_SCHEME_QUERY,
  PAGE_TOKENS_STYLE_ID,
  applyPageTheme,
  pageTokensCss,
} from "@/src/ui/pageTheme";

interface FakeMediaQuery {
  list: MediaQueryList;
  setMatches: (matches: boolean) => void;
}

function fakeMediaQuery(matches: boolean): FakeMediaQuery {
  const listeners = new Set<() => void>();
  const list = {
    matches,
    media: DARK_SCHEME_QUERY,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  } as unknown as MediaQueryList;
  return {
    list,
    setMatches: (next) => {
      (list as { matches: boolean }).matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("pageTokensCss", () => {
  it("re-targets the host selectors at the document root", () => {
    const source =
      ':host,\n:host([data-theme="light"]) {\n  --ink: #000;\n}\n:host([data-theme="dark"]) {\n  --ink: #fff;\n}\n';
    expect(pageTokensCss(source)).toBe(
      ':root,\n:root[data-theme="light"] {\n  --ink: #000;\n}\n:root[data-theme="dark"] {\n  --ink: #fff;\n}\n',
    );
  });

  it("converts the real token sheet without leaving a host selector behind", () => {
    const css: string = pageTokensCss();
    expect(css).not.toContain(":host");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("--popup-width: 340px;");
  });
});

describe("applyPageTheme", () => {
  beforeEach(() => {
    document.getElementById(PAGE_TOKENS_STYLE_ID)?.remove();
    delete document.documentElement.dataset.theme;
  });

  it("installs the tokens once and sets the theme from the colour scheme", () => {
    const query: FakeMediaQuery = fakeMediaQuery(true);
    vi.spyOn(window, "matchMedia").mockReturnValue(query.list);
    applyPageTheme();
    applyPageTheme();
    const styles: NodeListOf<HTMLStyleElement> = document.querySelectorAll(
      `#${PAGE_TOKENS_STYLE_ID}`,
    );
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain(":root");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows scheme changes until stopped", () => {
    const query: FakeMediaQuery = fakeMediaQuery(false);
    vi.spyOn(window, "matchMedia").mockReturnValue(query.list);
    const stop: () => void = applyPageTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    query.setMatches(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    stop();
    query.setMatches(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
