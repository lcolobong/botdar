import { registrableDomainOf } from "@/src/core/links/registrableDomain";
import topDomainList from "@/src/core/links/topDomains.json" with { type: "json" };
import { isCommonDomain, rareDomainsOf } from "@/src/core/links/topDomains";

describe("the bundled top-domain list", () => {
  it("holds 1,000 distinct domains", () => {
    expect(topDomainList).toHaveLength(1000);
    expect(new Set(topDomainList).size).toBe(1000);
  });

  it("lists only names the registrable-domain approximation produces", () => {
    for (const domain of topDomainList) {
      expect(registrableDomainOf(`https://${domain}/`), domain).toBe(domain);
    }
  });
});

describe("rareDomainsOf", () => {
  it("keeps each small site once and drops the most-visited domains", () => {
    const domains: Set<string> = rareDomainsOf([
      "https://www.youtube.com/watch?v=1",
      "https://en.wikipedia.org/wiki/Walnut",
      "https://news.example-gazette.net/a",
      "https://example-gazette.net/b",
      "https://www.bbc.co.uk/news",
    ]);
    expect([...domains]).toEqual(["example-gazette.net"]);
  });

  it("drops the platforms' own domains, shorteners, archive mirrors and gif pickers", () => {
    for (const domain of ["x.com", "t.co", "redd.it", "bsky.app", "ycombinator.com"]) {
      expect(isCommonDomain(domain), domain).toBe(true);
    }
    expect(
      rareDomainsOf([
        "https://news.ycombinator.com/item?id=1",
        "https://buff.ly/3abc",
        "https://archive.today/xyz",
        "https://media.tenor.com/a.gif",
        "https://i.redd.it/b.png",
      ]).size,
    ).toBe(0);
  });

  it("skips links it cannot read a domain from", () => {
    expect(rareDomainsOf(["mailto:a@example-gazette.net", "item?id=4"]).size).toBe(0);
  });
});
