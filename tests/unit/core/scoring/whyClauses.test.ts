import { NO_REASON, renderReason, templatedFeatureIds } from "@/src/core/scoring/reasons";
import {
  DECLARED_WHY,
  allWhyClauses,
  directionFor,
  featureIdsWithWhyClauses,
  whyFor,
} from "@/src/core/scoring/whyClauses";
import type { ReasonDirection } from "@/src/core/types";
import { NOW, signalsWith } from "./testWeights";

const MAX_WHY_WORDS = 8;

describe("why clauses", () => {
  it("has a clause for every reason template", () => {
    expect(featureIdsWithWhyClauses().sort()).toEqual(templatedFeatureIds().sort());
  });

  it("keeps every clause short enough to read at a glance", () => {
    for (const clause of allWhyClauses()) {
      expect(clause.split(/\s+/).length).toBeLessThanOrEqual(MAX_WHY_WORDS);
    }
  });

  it("points positive evidence towards automated and negative evidence towards ordinary", () => {
    expect(directionFor("x.postsPerDay", 1.5)).toBe("automated");
    expect(directionFor("x.accountAgeDays", -0.5)).toBe("ordinary");
  });

  it("points evidence that weighs nothing towards ordinary unless the feature has no ordinary reading", () => {
    expect(directionFor("reddit.noAvatar", 0)).toBe("ordinary");
    expect(directionFor("reddit.postToCommentKarma", 0)).toBe("ordinary");
    expect(directionFor("x.countryLocaleMismatch", 0)).toBe("automated");
  });

  it("picks the clause for the direction", () => {
    expect(whyFor("bsky.followsRatio", "automated")).toBe("mass-following nobody returned");
    expect(whyFor("bsky.followsRatio", "ordinary")).toBe("others opted in");
    expect(whyFor("reddit.noVerifiedEmail", "ordinary")).toBe("a mailbox sits behind this account");
    expect(whyFor("x.somethingNew", "automated")).toBe("");
  });

  it("gives every worded reason that weighs nothing a clause", () => {
    for (const featureId of templatedFeatureIds()) {
      for (const value of [0, 1, 2, 21, 3000, true, false]) {
        const text: string = renderReason(featureId, {
          value,
          contribution: 0,
          signals: signalsWith(),
          now: NOW,
        });
        const direction: ReasonDirection = directionFor(featureId, 0);
        if (text !== NO_REASON) {
          expect(whyFor(featureId, direction), `${featureId}=${String(value)}`).not.toBe("");
        }
      }
    }
  });

  it("explains the declared reason without inference", () => {
    expect(allWhyClauses()).toContain(DECLARED_WHY);
  });
});
