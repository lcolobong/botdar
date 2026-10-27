import type { VideoCreator } from "@/src/platforms/youtube/handles";
import { imitatesCreator, imitationKey, isAssignedHandle } from "@/src/platforms/youtube/handles";

const BBC: VideoCreator = { handles: new Set(["bbcnews"]), names: ["BBC News", "BBCNews"] };
const TED: VideoCreator = { handles: new Set(["ted"]), names: ["TED", "TED"] };

describe("isAssignedHandle", () => {
  it("matches the codes YouTube assigns, as recorded on 2026-10-27, in any script", () => {
    for (const handle of [
      "LarryH-h6q",
      "MK-to4et",
      "David-q5h1p",
      "Ασσουρμπανιπάλ-ψ9χ",
      "user-zk8ed4kd2b",
    ]) {
      expect(isAssignedHandle(handle), handle).toBe(true);
    }
  });

  it("leaves chosen handles and the 2022 name-plus-four-digits batch alone", () => {
    for (const handle of [
      "GeckoHiker",
      "janewatkins9801",
      "Lee-337-eeL",
      "-Lucky-Six-",
      "blas-femy",
    ]) {
      expect(isAssignedHandle(handle), handle).toBe(false);
    }
  });

  it("reads a tail of digits alone as chosen, often a year: an assigned code has a letter too", () => {
    for (const handle of ["euro-2024", "bbcnews-2024", "club-007"]) {
      expect(isAssignedHandle(handle), handle).toBe(false);
    }
    expect(isAssignedHandle("club-0a7")).toBe(true);
  });
});

describe("imitatesCreator", () => {
  it("matches the creator's name with separators, digits, an assigned code or an impersonator's word", () => {
    for (const candidate of [
      "BBC.News",
      "bbc_news",
      "BBCNews-x7k",
      "bbcnews_official1",
      "OfficialBBCNews",
      "BBCNewsTM",
      "BBC News",
    ]) {
      expect(imitatesCreator(candidate, BBC), candidate).toBe(true);
    }
  });

  it("folds look-alike letters from other scripts and accents", () => {
    expect(imitationKey("BBC Nеws")).toBe("bbcnews");
    expect(imitationKey("ΒΒC Νews")).not.toBe("");
    expect(imitatesCreator("BBC Nеws", BBC)).toBe(true);
    expect(imitatesCreator("Bbcnéws", BBC)).toBe(true);
  });

  it("leaves fans, other names and creators with short names alone", () => {
    for (const candidate of ["bbcnewsfan", "ilovebbcnews", "GeckoHiker", "bbcsport"]) {
      expect(imitatesCreator(candidate, BBC), candidate).toBe(false);
    }
    expect(imitatesCreator("ted1985", TED)).toBe(false);
  });

  it("never strips a digit tail as an assigned code: @bbcnews-2024 imitates only as name plus digits", () => {
    // The creator's name with digits is the documented pattern ("alone or with digits"). The year is
    // not YouTube's code, so it is read as part of the chosen handle and assignedHandle stays off.
    expect(imitatesCreator("bbcnews-2024", BBC)).toBe(true);
    expect(isAssignedHandle("bbcnews-2024")).toBe(false);
    expect(imitatesCreator("bbcnewsfan-2024", BBC)).toBe(false);
    expect(imitatesCreator("euro-2024", BBC)).toBe(false);
  });
});
