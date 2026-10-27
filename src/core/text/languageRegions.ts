/**
 * Where each language the detector reports is plausibly the account holder's own: ISO 3166 codes of
 * the countries where it is official or spoken by a large share of residents. A global language
 * lists every country where it is official, so French in Senegal or Arabic in Chad never reads as a
 * mismatch. English has no set at all: it is the lingua franca of the platforms, written by people
 * everywhere, so an English bio says nothing about where its writer lives and never mismatches.
 * Close neighbours share a set where the detector cannot tell them apart (Swedish stands for
 * Norwegian and Danish, Indonesian for Malay, Czech for Slovak, Serbian for Montenegrin and
 * Bosnian), and the sets lean wide: a missing country costs a person a false mismatch, an extra one
 * costs only a missed signal.
 */

const PLAUSIBLE_REGIONS: Readonly<Record<string, string>> = {
  es: "ES MX AR CO PE VE CL EC GT CU BO DO HN PY SV NI CR PA UY PR GQ US AD GI BZ",
  pt: "PT BR AO MZ CV GW ST TL MO GQ",
  fr:
    "FR BE CH LU MC CA HT CD CG CI CM SN ML BF NE TD GN BJ TG GA CF MG KM DJ RW BI SC VU MA DZ TN " +
    "LB MR MU NC PF RE GP MQ GF YT PM WF BL MF AD",
  ar: "SA AE QA KW BH OM YE IQ SY JO LB PS EG LY TN DZ MA MR SD SO DJ KM IL TD ER EH",
  de: "DE AT CH LI LU BE",
  it: "IT SM VA CH MT",
  nl: "NL BE SR AW CW SX BQ",
  af: "ZA NA",
  tr: "TR CY",
  pl: "PL",
  id: "ID MY SG BN TL",
  sv: "SE FI AX NO DK",
  vi: "VN",
  tl: "PH",
  ro: "RO MD",
  cs: "CZ SK",
  hu: "HU RO SK RS",
  fi: "FI",
  ru: "RU BY KZ KG UA MD LV EE LT UZ TJ TM AM GE AZ IL",
  uk: "UA",
  bg: "BG MD",
  sr: "RS BA ME XK HR",
  mk: "MK",
  zh: "CN TW HK MO SG MY",
  ja: "JP",
  ko: "KR KP",
  th: "TH",
  el: "GR CY",
  he: "IL",
  hi: "IN NP",
  bn: "BD IN",
  ta: "IN LK SG MY",
  te: "IN",
  gu: "IN",
  pa: "IN PK",
  kn: "IN",
  ml: "IN",
  si: "LK",
  fa: "IR AF TJ",
  ur: "PK IN",
  lo: "LA",
  km: "KH",
  my: "MM",
  ka: "GE",
  hy: "AM",
  am: "ET",
};

const REGION_SETS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(PLAUSIBLE_REGIONS).map(([language, regions]) => [
    language,
    new Set(regions.split(" ")),
  ]),
);

/** The plausible regions for an ISO 639-1 code, or undefined for a language with no table. */
export function plausibleRegionsFor(language: string): ReadonlySet<string> | undefined {
  return REGION_SETS.get(language);
}
