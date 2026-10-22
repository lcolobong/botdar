import {
  digitCount,
  isBskySocialHandleWithDigits,
  isRedditGeneratedName,
  looksLikeNamePlusDigits,
  trailingDigitCount,
} from "@/src/core/handle/shape";

describe("digitCount", () => {
  it.each([
    ["jordan_reads", 0],
    ["ava1990", 4],
    ["user8827364512", 10],
    ["a1b2c3", 3],
    ["", 0],
  ])("%s has %i digits", (handle, expected) => {
    expect(digitCount(handle)).toBe(expected);
  });
});

describe("trailingDigitCount", () => {
  it.each([
    ["jordan_reads", 0],
    ["ava1990", 4],
    ["user8827364512", 10],
    ["a1b2c3", 1],
    ["42signals", 0],
    ["12345", 5],
    ["", 0],
  ])("%s ends with %i digits", (handle, expected) => {
    expect(trailingDigitCount(handle)).toBe(expected);
  });
});

describe("looksLikeNamePlusDigits", () => {
  it.each(["user8827364512", "ava1990", "jordan82736451", "mike2024"])("matches %s", (handle) => {
    expect(looksLikeNamePlusDigits(handle)).toBe(true);
  });

  it.each([
    "jordan_reads",
    "marcusdev",
    "sarah_jones",
    "ava199",
    "ava_1990",
    "42ava1990",
    "a1b2c3d4",
    "1990",
    "",
  ])("does not match %s", (handle) => {
    expect(looksLikeNamePlusDigits(handle)).toBe(false);
  });

  it("honours a stricter minimum digit run", () => {
    expect(looksLikeNamePlusDigits("ava1990", 5)).toBe(false);
    expect(looksLikeNamePlusDigits("ava19901", 5)).toBe(true);
  });
});

describe("isRedditGeneratedName", () => {
  it.each(["Quiet-Harbor-4471", "Quiet_Harbor_4471", "Fluffy-Otter-92", "Brave_Lemon_123"])(
    "matches %s",
    (handle) => {
      expect(isRedditGeneratedName(handle)).toBe(true);
    },
  );

  it.each([
    "quiet-harbor-4471",
    "Quiet-harbor-4471",
    "Quiet-Harbor-4",
    "Quiet-Harbor-44712",
    "Quiet-Harbor",
    "QuietHarbor4471",
    "Quiet-Harbor_4471x",
    "jordan_reads",
    "Ava1990",
    "",
  ])("does not match %s", (handle) => {
    expect(isRedditGeneratedName(handle)).toBe(false);
  });
});

describe("isBskySocialHandleWithDigits", () => {
  it.each(["priya123.bsky.social", "jordan82736451.bsky.social", "a1b2c3.bsky.social"])(
    "matches %s",
    (handle) => {
      expect(isBskySocialHandleWithDigits(handle)).toBe(true);
    },
  );

  it.each([
    "priya.bsky.social",
    "priya-natarajan2.bsky.social",
    "priya12.bsky.social",
    "priya123.example.com",
    "priya123",
    ".bsky.social",
    "",
  ])("does not match %s", (handle) => {
    expect(isBskySocialHandleWithDigits(handle)).toBe(false);
  });
});
