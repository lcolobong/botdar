/**
 * Turns a country name as a platform prints it ("United States", "Brasil") into an ISO 3166 code.
 * X's About dialog names the country in the viewer's X display language and never gives a code, so
 * every two-letter code is rendered in English and in the display language, long and short forms,
 * and the reverse map is built once per locale pair. A name that matches nothing (a region such as
 * "Europe", a spelling ICU does not use) resolves to undefined, so no mismatch is ever declared on a
 * name that was not understood.
 */

const ASCII_A = 65;
const LETTER_COUNT = 26;
/** Former or common English names X may print where ICU prints another. */
const ALIASES: Readonly<Record<string, string>> = {
  turkey: "TR",
  "czech republic": "CZ",
  "ivory coast": "CI",
  "cape verde": "CV",
  "east timor": "TL",
  swaziland: "SZ",
  macedonia: "MK",
  burma: "MM",
  "democratic republic of the congo": "CD",
  "republic of the congo": "CG",
  "united states of america": "US",
  "the netherlands": "NL",
};

/**
 * Codes ICU names that are not one country: unions, pseudo-locales, the unknown region, and the
 * exceptional reservations for parts of a country (the Canary Islands, Ceuta and Melilla). Each is
 * left unresolved, so a Spanish-speaking account based in the Canary Islands cannot read as abroad.
 */
const NON_COUNTRY_CODES: ReadonlySet<string> = new Set(
  "AC CP DG EA EU EZ IC QO TA UN XA XB ZZ".split(" "),
);

const namesByLocales = new Map<string, ReadonlyMap<string, string>>();

function normalisedName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’']/g, "'").toLowerCase().trim();
}

/** Retired codes (DD, SU, YU) render as their successor's name, so they resolve to the successor. */
function canonicalRegionCode(code: string): string {
  try {
    return Intl.getCanonicalLocales(`und-${code}`)[0]?.split("-")[1] ?? code;
  } catch {
    return code;
  }
}

let regionCodes: readonly string[] | undefined;

/** Every country code ICU can name, built once on first use. */
function allRegionCodes(): readonly string[] {
  if (regionCodes === undefined) {
    const letters: string[] = Array.from({ length: LETTER_COUNT }, (_, index) =>
      String.fromCharCode(ASCII_A + index),
    );
    const codes: string[] = letters
      .flatMap((first) => letters.map((second) => canonicalRegionCode(`${first}${second}`)))
      .filter((code) => !NON_COUNTRY_CODES.has(code));
    regionCodes = [...new Set(codes)];
  }
  return regionCodes;
}

function languageSubtagOf(locale: string): string {
  try {
    return new Intl.Locale(locale).language;
  } catch {
    return locale;
  }
}

/** English first, then each further locale whose language is not already listed ("en-US" adds none). */
function namingLocales(locales: readonly string[]): string[] {
  const byLanguage = new Map<string, string>([["en", "en"]]);
  for (const locale of locales) {
    const language: string = languageSubtagOf(locale);
    if (!byLanguage.has(language)) {
      byLanguage.set(language, locale);
    }
  }
  return [...byLanguage.values()];
}

function buildNameMap(locales: readonly string[]): ReadonlyMap<string, string> {
  const codesByName = new Map<string, string>(Object.entries(ALIASES));
  for (const locale of locales) {
    for (const style of ["long", "short"] as const) {
      let displayNames: Intl.DisplayNames;
      try {
        displayNames = new Intl.DisplayNames([locale], { type: "region", style, fallback: "none" });
      } catch {
        continue;
      }
      const codes: readonly string[] = allRegionCodes();
      for (const code of codes) {
        const name: string | undefined = displayNames.of(code);
        if (name !== undefined && !codesByName.has(normalisedName(name))) {
          codesByName.set(normalisedName(name), code);
        }
      }
    }
  }
  return codesByName;
}

/** The ISO 3166 code for a country name in English or in one of `locales`, else undefined. */
export function regionCodeForCountryName(
  name: string,
  locales: readonly string[] = [],
): string | undefined {
  const allLocales: string[] = namingLocales(locales);
  const key: string = allLocales.join(",");
  let codesByName: ReadonlyMap<string, string> | undefined = namesByLocales.get(key);
  if (codesByName === undefined) {
    codesByName = buildNameMap(allLocales);
    namesByLocales.set(key, codesByName);
  }
  return codesByName.get(normalisedName(name));
}
