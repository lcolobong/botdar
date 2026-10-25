import {
  bioDeclaresAutomation,
  flairDeclaresAutomation,
  isSelfDescribedBotName,
} from "@/src/core/handle/selfDescription";

describe("isSelfDescribedBotName", () => {
  it.each([
    "RemindMeBot",
    "haiku_bot",
    "GPT2Bot",
    "Mistral_Bot_2",
    "AutoModerator",
    "automoderator",
  ])("accepts %s", (name) => {
    expect(isSelfDescribedBotName(name)).toBe(true);
  });

  it.each([
    "Talbot",
    "botanist_jane",
    "BotHunter",
    "bot_lover",
    "Den_Hviide",
    "Quiet_Lantern_4821",
  ])("rejects %s", (name) => {
    expect(isSelfDescribedBotName(name)).toBe(false);
  });
});

describe("flairDeclaresAutomation", () => {
  it("accepts a flair that ends in bot or says so in a sentence", () => {
    expect(flairDeclaresAutomation("Verified GPT-2 Bot")).toBe(true);
    expect(flairDeclaresAutomation("Verified GPT-2 Bot ✅")).toBe(true);
    expect(flairDeclaresAutomation("I am a bot, beep boop")).toBe(true);
  });

  it("rejects flair about bots", () => {
    expect(flairDeclaresAutomation("Bot Developer")).toBe(false);
    expect(flairDeclaresAutomation("Bot hunter")).toBe(false);
    expect(flairDeclaresAutomation("Moderator")).toBe(false);
  });
});

describe("bioDeclaresAutomation", () => {
  it("needs the account to say it is a bot in so many words", () => {
    expect(bioDeclaresAutomation("I am a bot. Beep boop.")).toBe(true);
    expect(bioDeclaresAutomation("I'm a GPT-2 bot trained on r/politics")).toBe(true);
    expect(bioDeclaresAutomation("This account is a reply bot run by u/someone")).toBe(true);
    expect(bioDeclaresAutomation("bot hunter, coffee drinker")).toBe(false);
    expect(bioDeclaresAutomation("my friends call me a bot")).toBe(false);
  });
});
