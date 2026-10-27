import { regionCodeForCountryName } from "@/src/core/text/countryNames";
import { plausibleRegionsFor } from "@/src/core/text/languageRegions";

describe("regionCodeForCountryName", () => {
  it.each([
    ["United States", "US"],
    ["united states", "US"],
    ["Brazil", "BR"],
    ["Türkiye", "TR"],
    ["Turkiye", "TR"],
    ["Turkey", "TR"],
    ["Hong Kong", "HK"],
    ["Czech Republic", "CZ"],
    ["Côte d'Ivoire", "CI"],
    ["  Japan ", "JP"],
  ])("reads %s as %s", (name, code) => {
    expect(regionCodeForCountryName(name)).toBe(code);
  });

  it("reads names printed in another display language only when told the language", () => {
    expect(regionCodeForCountryName("Deutschland")).toBeUndefined();
    expect(regionCodeForCountryName("Deutschland", ["de-DE"])).toBe("DE");
    expect(regionCodeForCountryName("Estados Unidos", ["es"])).toBe("US");
  });

  it("leaves regions, unions and unknown names unresolved", () => {
    for (const name of ["Europe", "European Union", "Canary Islands", "Unknown Region", "Narnia"]) {
      expect(regionCodeForCountryName(name)).toBeUndefined();
    }
  });

  it("reads a regional English locale like English", () => {
    expect(regionCodeForCountryName("Brazil", ["en-US"])).toBe("BR");
    expect(regionCodeForCountryName("Deutschland", ["en-GB", "de-AT"])).toBe("DE");
  });

  it("survives a locale Intl cannot read", () => {
    expect(regionCodeForCountryName("Brazil", ["not a locale!"])).toBe("BR");
  });
});

describe("plausibleRegionsFor", () => {
  it("gives English no set, so an English bio never mismatches", () => {
    expect(plausibleRegionsFor("en")).toBeUndefined();
  });

  it("lists every country where a global language is official", () => {
    for (const region of ["FR", "SN", "CA", "CI"]) {
      expect(plausibleRegionsFor("fr")?.has(region)).toBe(true);
    }
    expect(plausibleRegionsFor("pt")?.has("AO")).toBe(true);
    expect(plausibleRegionsFor("es")?.has("US")).toBe(true);
  });

  it("has a set for every language the detector can report", () => {
    const detectable: string[] = [
      ...["es", "pt", "fr", "de", "it", "nl", "af", "tr", "pl", "id", "sv", "vi", "tl"],
      ...["ro", "cs", "hu", "fi", "ru", "uk", "bg", "sr", "mk", "zh", "ja", "ko", "th"],
      ...["el", "he", "hi"],
      ...["bn", "ta", "te", "gu", "pa", "kn", "ml", "si", "fa", "ur", "ar", "lo", "km"],
      ...["my", "ka", "hy", "am"],
    ];
    for (const language of detectable) {
      expect(plausibleRegionsFor(language)?.size, language).toBeGreaterThan(0);
    }
    expect(plausibleRegionsFor("xx")).toBeUndefined();
  });
});
