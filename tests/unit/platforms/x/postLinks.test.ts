import { expandedLinksOf } from "@/src/platforms/x/parsers/postLinks";

const urls = (...expanded: unknown[]) => ({
  urls: expanded.map((link) => ({ url: "https://t.co/abc", expanded_url: link })),
});

describe("expandedLinksOf", () => {
  it("reads each link's expanded target, not its t.co address", () => {
    expect(
      expandedLinksOf({ legacy: { entities: urls("https://example-gazette.net/a") } }),
    ).toEqual(["https://example-gazette.net/a"]);
  });

  it("adds a long post's links and keeps each link once", () => {
    const post = {
      legacy: { entities: urls("https://example-gazette.net/a") },
      note_tweet: {
        note_tweet_results: {
          result: {
            entity_set: urls("https://example-gazette.net/a", "https://another-blog.org/b"),
          },
        },
      },
    };
    expect(expandedLinksOf(post)).toEqual([
      "https://example-gazette.net/a",
      "https://another-blog.org/b",
    ]);
  });

  it("skips malformed entries, overlong links and anything past the tenth link", () => {
    expect(
      expandedLinksOf({ legacy: { entities: { urls: [null, "x", { expanded_url: 7 }] } } }),
    ).toEqual([]);
    expect(
      expandedLinksOf({ legacy: { entities: urls(`https://example.org/${"a".repeat(3000)}`) } }),
    ).toEqual([]);
    const many: string[] = Array.from({ length: 15 }, (_, index) => `https://s${index}.example/`);
    expect(expandedLinksOf({ legacy: { entities: urls(...many) } })).toHaveLength(10);
  });

  it("reads nothing from a post without entities", () => {
    expect(expandedLinksOf({ legacy: { full_text: "no links" } })).toEqual([]);
    expect(expandedLinksOf({ legacy: { entities: { urls: "nope" } } })).toEqual([]);
  });
});
