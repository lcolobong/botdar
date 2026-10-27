/**
 * The registrable domain of a link (the name someone registers, "example.co.uk" for
 * "news.example.co.uk"), for the shared rare domain feature (ADR-0029). An approximation of the
 * Public Suffix List rather than the list itself: the last two labels, or the last three when the
 * last two are one of the multi-label suffixes below. The full list is about 10,000 rules and
 * 200 KB, and the cases it would get right that this does not are hosting suffixes
 * ("<blog>.github.io", "<site>.blogspot.com") and rarer country second levels, each of which this
 * folds into one domain: never a false "rare" domain, only a missed one. A "www." label falls
 * away with the subdomains.
 */

/**
 * Country second levels under which people register names. Every one that appears in the bundled
 * top-domain list is here (topDomains.test.ts checks), so a listed domain is always recognised.
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "gov.au",
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.nz",
  "org.nz",
  "co.in",
  "co.za",
  "co.id",
  "co.kr",
  "com.ar",
  "com.cn",
  "gov.cn",
  "com.hk",
  "com.mx",
  "com.sg",
  "com.tr",
  "com.tw",
]);

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The link's registrable domain, lowercased; undefined for an IP address or a non-web link. */
export function registrableDomainOf(link: string): string | undefined {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  // URL lowercases the host and writes international names as punycode.
  const host: string = url.hostname.replace(/\.$/, "");
  if (!WEB_PROTOCOLS.has(url.protocol) || host.startsWith("[") || IPV4_PATTERN.test(host)) {
    return undefined;
  }
  const labels: string[] = host.split(".");
  const suffixLabelCount: number = MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 2 : 1;
  if (labels.length <= suffixLabelCount || labels.some((label) => label.length === 0)) {
    return undefined;
  }
  return labels.slice(-(suffixLabelCount + 1)).join(".");
}
