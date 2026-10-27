import { accountLanguage, countryLanguageMismatch } from "@/src/core/text/accountLanguage";

const FRENCH_BIO =
  "Photographe basée à la campagne. Je partage mes images de la nature et les petites choses qui font mon quotidien.";
const ENGLISH_BIO =
  "Coffee first, then code. I write about the small tools that make our work easier and I share what I learn.";
/** Residents writing their own language, which the profiles once read as Russian or Dutch. */
const BULGARIAN_BIO =
  "Аз съм учителка и майка на две деца. Тук пиша за книги, пътувания и за това, което се случва в моя град всеки ден.";
const SERBIAN_BIO =
  "Ја сам учитељица и мајка двоје деце. Овде пишем о књигама, путовањима и о ономе што се дешава у мом граду сваког дана.";
const AFRIKAANS_BIO =
  "Ek is 'n onderwyser en ma van twee kinders. Hier skryf ek oor boeke, reise en die lewe in ons klein dorpie, en ook oor koffie.";

const mismatchOf = (country: string, bio: string): boolean | undefined =>
  countryLanguageMismatch(country, { bio })?.mismatch;

describe("accountLanguage", () => {
  it("reads the bio and the post text together", () => {
    expect(accountLanguage({ bio: "Photographe." })).toBeUndefined();
    expect(accountLanguage({ bio: "Photographe.", postText: FRENCH_BIO })?.language).toBe("fr");
    expect(accountLanguage({})).toBeUndefined();
  });
});

describe("countryLanguageMismatch", () => {
  it("is false where the language is plausibly a resident's own", () => {
    expect(mismatchOf("France", FRENCH_BIO)).toBe(false);
    expect(mismatchOf("Senegal", FRENCH_BIO)).toBe(false);
    expect(mismatchOf("Bulgaria", BULGARIAN_BIO)).toBe(false);
    expect(mismatchOf("Serbia", SERBIAN_BIO)).toBe(false);
    expect(mismatchOf("Montenegro", SERBIAN_BIO)).toBe(false);
    expect(mismatchOf("South Africa", AFRIKAANS_BIO)).toBe(false);
    expect(mismatchOf("Namibia", AFRIKAANS_BIO)).toBe(false);
  });

  it("is true where it is not, and names the language it compared", () => {
    expect(countryLanguageMismatch("Russia", { bio: FRENCH_BIO })).toEqual({
      mismatch: true,
      language: "fr",
    });
    expect(mismatchOf("Brazil", BULGARIAN_BIO)).toBe(true);
  });

  it("never compares English, the lingua franca", () => {
    for (const country of ["Germany", "Brazil", "Japan", "India"]) {
      expect(countryLanguageMismatch(country, { bio: ENGLISH_BIO })).toBeUndefined();
    }
  });

  it("never compares a language read at low confidence", () => {
    const nearTie: string =
      "Sono un cuoco e scrivo di ricette per tutti voi. Soy cocinero y escribo recetas para todos ustedes cada día.";
    expect(countryLanguageMismatch("Russia", { bio: nearTie })).toBeUndefined();
  });

  it("is undefined with nothing to compare", () => {
    expect(countryLanguageMismatch("France", { bio: "Photographe." })).toBeUndefined();
    expect(countryLanguageMismatch("Europe", { bio: FRENCH_BIO })).toBeUndefined();
  });
});
