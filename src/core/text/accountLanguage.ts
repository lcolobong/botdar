/**
 * The language an account writes in, read from its own bio and the post text Tier 1 kept, and
 * whether the country the platform lists for it is one where that language is plausibly a
 * resident's own (docs/scoring-spec.md, "Country mismatch"). The viewer's locale only helps read the
 * country's name; it is never what the account is compared with.
 */
import type { AccountSignals } from "../types";
import { regionCodeForCountryName } from "./countryNames";
import type { DetectedLanguage } from "./language";
import { detectLanguage } from "./language";
import { plausibleRegionsFor } from "./languageRegions";

type AccountText = Pick<AccountSignals, "bio" | "postText">;

export function accountLanguage(signals: AccountText): DetectedLanguage | undefined {
  const text: string = [signals.bio, signals.postText]
    .filter((part) => part !== undefined)
    .join("\n");
  return detectLanguage(text);
}

/**
 * A language read below this confidence is a near tie between two profiles; a mismatch built on it
 * would accuse a person of the runner-up's geography, so it is never compared.
 */
const MIN_MISMATCH_CONFIDENCE = 0.5;

export interface CountryLanguageComparison {
  /** True when the country is not among the plausible regions of the language. */
  mismatch: boolean;
  /** The ISO 639-1 code compared, for the reason line. */
  language: string;
}

/**
 * Whether `country` is among the plausible regions of the account's language, or undefined when
 * there is nothing to compare: no language detected, one read at low confidence, a language with no
 * region table (English, the lingua franca, has none), or a country name that resolves to no code.
 * `locales` are the languages the platform may have printed the name in, besides English.
 */
export function countryLanguageMismatch(
  country: string,
  signals: AccountText,
  locales: readonly string[] = [],
): CountryLanguageComparison | undefined {
  const detected: DetectedLanguage | undefined = accountLanguage(signals);
  if (detected === undefined || detected.confidence < MIN_MISMATCH_CONFIDENCE) {
    return undefined;
  }
  const plausibleRegions: ReadonlySet<string> | undefined = plausibleRegionsFor(detected.language);
  const region: string | undefined =
    plausibleRegions === undefined ? undefined : regionCodeForCountryName(country, locales);
  return plausibleRegions === undefined || region === undefined
    ? undefined
    : { mismatch: !plausibleRegions.has(region), language: detected.language };
}
