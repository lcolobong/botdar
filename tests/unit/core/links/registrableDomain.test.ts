import { registrableDomainOf } from "@/src/core/links/registrableDomain";

describe("registrableDomainOf", () => {
  it("keeps the last two labels of an ordinary host, lowercased, without www or subdomains", () => {
    expect(registrableDomainOf("https://www.Example.com/story?id=1")).toBe("example.com");
    expect(registrableDomainOf("http://news.blog.example.org/")).toBe("example.org");
    expect(registrableDomainOf("https://example.net.:8443/a")).toBe("example.net");
  });

  it("keeps a third label under a multi-label country suffix", () => {
    expect(registrableDomainOf("https://www.example.co.uk/a")).toBe("example.co.uk");
    expect(registrableDomainOf("https://shop.example.com.br/")).toBe("example.com.br");
    expect(registrableDomainOf("https://example.co.jp")).toBe("example.co.jp");
  });

  it("folds a hosting suffix the approximation does not know into one domain", () => {
    expect(registrableDomainOf("https://someone.github.io/post")).toBe("github.io");
  });

  it("writes an international name as punycode", () => {
    expect(registrableDomainOf("https://www.bücher.de/")).toBe("xn--bcher-kva.de");
  });

  it("has no domain for an IP address, a bare suffix, a single label or a non-web link", () => {
    expect(registrableDomainOf("http://192.168.0.1/admin")).toBeUndefined();
    expect(registrableDomainOf("http://[2001:db8::1]/")).toBeUndefined();
    expect(registrableDomainOf("https://co.uk/")).toBeUndefined();
    expect(registrableDomainOf("http://localhost:3000/")).toBeUndefined();
    expect(registrableDomainOf("mailto:someone@example.com")).toBeUndefined();
    expect(registrableDomainOf("javascript:void(0)")).toBeUndefined();
    expect(registrableDomainOf("not a url")).toBeUndefined();
  });
});
