import { detectLanguage } from "@/src/core/text/language";

/** Bio-length text in each language the profiles cover: one or two sentences, about 15–25 words. */
const BIOS: Readonly<Record<string, string>> = {
  en: "Coffee first, then code. I write about the small tools that make our work easier and I share what I learn along the way.",
  es: "Periodista y lectora. Escribo sobre ciencia y tecnología para que todo el mundo pueda entender lo que pasa en el laboratorio.",
  pt: "Professora de história e mãe de dois. Aqui eu falo sobre livros, viagens e tudo o que me faz pensar no nosso país.",
  fr: "Photographe basée à la campagne. Je partage mes images de la nature et les petites choses qui font mon quotidien avec vous.",
  de: "Ich bin Lehrerin und schreibe hier über Bücher, Musik und das Leben auf dem Land. Meine Meinung ist nur meine eigene.",
  it: "Cuoco per passione e ingegnere per lavoro. Qui condivido le mie ricette e anche qualche pensiero sulla vita di tutti i giorni.",
  nl: "Ik ben een fotograaf uit het noorden en ik deel hier mijn foto's van de zee, de wolken en het leven op het platteland.",
  tr: "Bir öğretmen ve iki çocuk annesiyim. Burada kitaplar, seyahat ve günlük hayat hakkında yazıyorum, bazen de çok fazla kahve içiyorum.",
  pl: "Jestem nauczycielką i mamą. Piszę tutaj o książkach, podróżach i o tym, co się dzieje w moim mieście, ale też o kawie.",
  id: "Saya seorang guru dan penulis. Di sini saya berbagi cerita tentang buku, perjalanan dan kehidupan sehari-hari dengan keluarga saya yang kecil.",
  sv: "Jag är lärare och skriver om böcker, musik och livet på landet. Det som står här är mina egna åsikter och inget annat.",
  ru: "Я учитель и мама двоих детей. Здесь я пишу о книгах, путешествиях и о том, что происходит в моем городе каждый день.",
  uk: "Я вчителька і мама двох дітей. Тут я пишу про книжки, подорожі та про те, що відбувається в моєму місті щодня.",
  vi: "Tôi là một giáo viên và cũng là mẹ của hai đứa trẻ. Ở đây tôi viết về sách, du lịch và những điều nhỏ trong cuộc sống.",
  tl: "Ako ay isang guro at nanay ng dalawang bata. Dito ko ibinabahagi ang mga kwento tungkol sa mga libro at sa buhay namin.",
  ro: "Sunt profesoară și mamă a doi copii. Aici scriu despre cărți, călătorii și despre ce se întâmplă în orașul meu în fiecare zi.",
  cs: "Jsem učitelka a máma dvou dětí. Píšu tady o knihách, cestování a o tom, co se děje v mém městě, a také o kávě.",
  hu: "Tanár vagyok és két gyerek anyja. Itt könyvekről, utazásról és arról írok, ami a városomban történik, de néha csak a kávéról.",
  fi: "Olen opettaja ja kahden lapsen äiti. Kirjoitan täällä kirjoista ja matkoista, mutta myös siitä mitä minun kaupungissa tapahtuu joka päivä.",
  bg: "Аз съм учителка и майка на две деца. Тук пиша за книги, пътувания и за това, което се случва в моя град всеки ден.",
  sr: "Ја сам учитељица и мајка двоје деце. Овде пишем о књигама, путовањима и о ономе што се дешава у мом граду сваког дана.",
  mk: "Јас сум наставничка и мајка на две деца. Тука пишувам за книги, патувања и за она што се случува во мојот град секој ден.",
  af: "Ek is 'n onderwyser en ma van twee kinders. Hier skryf ek oor boeke, reise en die lewe in ons klein dorpie, en ook oor koffie.",
};

/** Non-Latin scripts decide on their own; length still has to clear the minimum. */
const SCRIPT_BIOS: Readonly<Record<string, string>> = {
  ja: "東京在住のエンジニアです。週末は写真を撮ったり、新しいカフェを探したりしています。よろしくお願いします。",
  zh: "我是一名老师，住在上海。平时喜欢看书、旅行和拍照，在这里分享我的生活和工作中的小事情。",
  ko: "서울에 사는 디자이너입니다. 주말에는 사진을 찍고 새로운 카페를 찾아다니는 것을 좋아합니다. 잘 부탁드립니다.",
  ar: "أنا معلمة وأم لطفلين. أكتب هنا عن الكتب والسفر والحياة اليومية في مدينتي الجميلة التي أحبها كثيرا جدا.",
  fa: "من یک معلم هستم و در تهران زندگی می‌کنم. اینجا درباره کتاب‌ها، سفر و زندگی روزمره‌ام می‌نویسم و گاهی عکس می‌گذارم.",
  ur: "میں ایک استاد ہوں اور لاہور میں رہتا ہوں۔ یہاں میں کتابوں، سفر اور روزمرہ زندگی کے بارے میں لکھتا ہوں اور تصویریں بھی شیئر کرتا ہوں۔",
  he: "אני מורה ואמא לשני ילדים. אני כותבת כאן על ספרים, טיולים והחיים הקטנים בעיר שלי, ולפעמים גם על קפה טוב.",
  el: "Είμαι δασκάλα και μητέρα δύο παιδιών. Εδώ γράφω για βιβλία, ταξίδια και για όσα συμβαίνουν στην πόλη μου κάθε μέρα.",
  hi: "मैं एक शिक्षक हूँ और दिल्ली में रहता हूँ। यहाँ मैं किताबों, यात्रा और रोज़मर्रा की ज़िंदगी के बारे में लिखता हूँ और तस्वीरें भी साझा करता हूँ।",
  th: "ฉันเป็นครูและเป็นแม่ของลูกสองคน ที่นี่ฉันเขียนเกี่ยวกับหนังสือ การเดินทาง และเรื่องราวเล็ก ๆ ในชีวิตประจำวัน",
};

describe("detectLanguage", () => {
  describe("Latin and Cyrillic profiles", () => {
    for (const [language, bio] of Object.entries(BIOS)) {
      it(`reads a ${language} bio`, () => {
        expect(detectLanguage(bio)?.language).toBe(language);
      });
    }
  });

  describe("scripts", () => {
    for (const [language, bio] of Object.entries(SCRIPT_BIOS)) {
      it(`reads a ${language} bio from its script`, () => {
        expect(detectLanguage(bio)?.language).toBe(language);
      });
    }
  });

  it("reports a confidence between 0 and 1", () => {
    for (const bio of [...Object.values(BIOS), ...Object.values(SCRIPT_BIOS)]) {
      const confidence: number | undefined = detectLanguage(bio)?.confidence;
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic", () => {
    expect(detectLanguage(BIOS.es ?? "")).toEqual(detectLanguage(BIOS.es ?? ""));
  });

  it("answers nothing for empty, short or wordless text", () => {
    expect(detectLanguage("")).toBeUndefined();
    expect(detectLanguage("   ")).toBeUndefined();
    expect(detectLanguage("Dad, runner, coffee lover. Views my own.")).toBeUndefined();
    expect(detectLanguage("Periodista. Lectora. Madrid.")).toBeUndefined();
    expect(detectLanguage("🚀🚀🚀 1234 5678 !!! ???")).toBeUndefined();
    expect(detectLanguage("東京在住です")).toBeUndefined();
  });

  it("ignores links, mentions and hashtags when counting words", () => {
    const padded: string =
      "Links: https://example.com/a https://example.com/b @someone @another #tag #more #again " +
      "#and #more #still #going #on #here";
    expect(detectLanguage(padded)).toBeUndefined();
  });

  it("answers nothing for an even mix of two languages", () => {
    const mixed: string =
      "I write about the tools that make our work easier. Escribo sobre ciencia para que todo el mundo entienda.";
    expect(detectLanguage(mixed)).toBeUndefined();
  });

  it("follows the language that clearly dominates a mix", () => {
    const mostlySpanish: string = `${BIOS.es} ${BIOS.es} Thanks for reading.`;
    expect(detectLanguage(mostlySpanish)?.language).toBe("es");
  });

  it("answers nothing when no script holds a clear majority", () => {
    const halfAndHalf: string = `${BIOS.en} ${SCRIPT_BIOS.ru ?? BIOS.ru}`;
    expect(detectLanguage(halfAndHalf)).toBeUndefined();
  });

  it("answers nothing for long Latin text in a language the profiles do not cover", () => {
    const swahili: string =
      "Mimi ni mwalimu na mama wa watoto wawili. Hapa ninaandika kuhusu vitabu, safari na maisha ya kila siku mjini.";
    expect(detectLanguage(swahili)).toBeUndefined();
  });

  it("tells Spanish from Portuguese and Russian from Ukrainian", () => {
    expect(detectLanguage(BIOS.pt ?? "")?.language).toBe("pt");
    expect(detectLanguage(BIOS.es ?? "")?.language).toBe("es");
    expect(detectLanguage(BIOS.uk ?? "")?.language).toBe("uk");
    expect(detectLanguage(BIOS.ru ?? "")?.language).toBe("ru");
  });
});
