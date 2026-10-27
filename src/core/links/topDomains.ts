/**
 * Which linked domains the shared rare domain feature counts (ADR-0029). Several accounts in one
 * thread linking the same small site is the tell; several linking YouTube, Wikipedia or a large
 * newspaper is ordinary conversation, so the most-visited domains on the web never count.
 *
 * topDomains.json is the top 1,000 of the Tranco list GQ3QK (https://tranco-list.eu/list/GQ3QK),
 * the daily list generated on 2026-10-26 from the 30 days 2026-09-27 to 2026-10-26, combining
 * the Chrome UX Report, Farsight, Majestic, Cloudflare Radar and Cisco Umbrella rankings by the
 * Dowdall rule, as registrable (pay-level) domains, in rank order. Refresh it whole, with the
 * list id and date here, rather than editing entries by hand.
 */
import topDomainList from "./topDomains.json" with { type: "json" };
import { registrableDomainOf } from "./registrableDomain";

const TOP_DOMAINS: ReadonlySet<string> = new Set(topDomainList);

/**
 * Domains outside the top list that still say nothing about who is behind a link: the four
 * platforms' own (a reply linking another post on the site), link shorteners (one domain for
 * every destination), archive mirrors (people post one for a paywalled story) and the gif pickers
 * the platforms' reply boxes embed.
 */
const LINK_SERVICE_DOMAINS: ReadonlySet<string> = new Set([
  "x.com",
  "twitter.com",
  "t.co",
  "twimg.com",
  "reddit.com",
  "redd.it",
  "redditmedia.com",
  "redditstatic.com",
  "bsky.app",
  "bsky.social",
  "ycombinator.com",
  "buff.ly",
  "ow.ly",
  "t.ly",
  "is.gd",
  "lnkd.in",
  "dlvr.it",
  "ift.tt",
  "archive.today",
  "archive.li",
  "archive.vn",
  "archive.md",
  "archive.fo",
  "12ft.io",
  "giphy.com",
  "tenor.com",
]);

/** True for a domain whose links the feature never counts. */
export function isCommonDomain(domain: string): boolean {
  return TOP_DOMAINS.has(domain) || LINK_SERVICE_DOMAINS.has(domain);
}

/** The distinct registrable domains among the links that the feature counts. */
export function rareDomainsOf(links: Iterable<string>): Set<string> {
  const domains = new Set<string>();
  for (const link of links) {
    const domain: string | undefined = registrableDomainOf(link);
    if (domain !== undefined && !isCommonDomain(domain)) {
      domains.add(domain);
    }
  }
  return domains;
}
